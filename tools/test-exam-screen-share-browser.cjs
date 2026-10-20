// Isolated browser regressions of the real screen-sharing hook and exam components.
// Display-media permission and playback are deterministic; all APIs are stubbed.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ts = require('typescript');
const { chromium } = require('playwright');

(async () => {
    const executablePath = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
        'C:/Program Files/Google/Chrome/Application/chrome.exe', chromium.executablePath()].find(fs.existsSync);
    const browser = await chromium.launch({ executablePath, headless: true });
    const failures = [];
    try {
        const page = await browser.newPage();
        let pageErrors = [];
        page.on('pageerror', error => { pageErrors.push(error.message); });
        const modules = {};
        for (const [name, pkg, file] of [
            ['react', 'react', 'react.development.js'],
            ['react-dom', 'react-dom', 'react-dom.development.js'],
            ['react-dom/client', 'react-dom', 'react-dom-client.development.js'],
            ['react/jsx-runtime', 'react', 'react-jsx-runtime.development.js'],
            ['scheduler', 'scheduler', 'scheduler.development.js'],
        ]) modules[name] = fs.readFileSync(path.join(path.dirname(require.resolve(pkg)), 'cjs', file), 'utf8');
        for (const [name, file] of [
            ['@/hooks/useExamScreenshots', 'apps/web/hooks/useExamScreenshots.ts'],
            ['@/lib/exam-screenshots', 'apps/web/lib/exam-screenshots.ts'],
            ['@/lib/exam-evidence-outbox', 'apps/web/lib/exam-evidence-outbox.ts'],
            ['@/lib/exam-fullscreen', 'apps/web/lib/exam-fullscreen.ts'],
            ['@/lib/exam-clock', 'apps/web/lib/exam-clock.ts'],
            ['@/lib/per-key-queue', 'apps/web/lib/per-key-queue.ts'],
            ['./ExamStartPreparation', 'apps/web/app/components/questions/ExamStartPreparation.tsx'],
            ['ExamPage', 'apps/web/app/components/questions/ExamPage.tsx'],
        ]) modules[name] = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
        }).outputText;

        async function mount({ component = 'hook', surface = 'monitor', permission = 'success', play = 'success', holdDetails = false, remainingSeconds = 3600, evidence = null, authFailure = false, offlineSession = false } = {}) {
            await page.goto('about:blank');
            pageErrors = [];
            await page.evaluate(({ modules, component, surface, permission, play, holdDetails, remainingSeconds, evidence, authFailure, offlineSession }) => {
                const cache = {};
                const noop = () => {};
                const asyncNoop = async () => {};
                window.testMedia = { surface, permission, play, prompts: 0, streams: [], videos: [], options: [] };
                const media = window.testMedia;
                const fakeStream = () => {
                    const tracks = [new EventTarget(), new EventTarget()];
                    for (const [index, track] of tracks.entries()) {
                        track.kind = index === 0 ? 'video' : 'audio';
                        track.readyState = 'live'; track.stops = 0; track.onended = null; track.muted = false;
                        track.getSettings = () => ({ displaySurface: media.surface });
                        track.stop = () => { track.stops++; track.readyState = 'ended'; };
                        track.end = () => {
                            track.readyState = 'ended';
                            const event = new Event('ended');
                            track.dispatchEvent(event);
                            if (track.onended) track.onended(event);
                        };
                        track.setMuted = muted => {
                            track.muted = muted;
                            const type = muted ? 'mute' : 'unmute';
                            const event = new Event(type); track.dispatchEvent(event);
                            if (track['on' + type]) track['on' + type](event);
                        };
                    }
                    const stream = { getTracks: () => tracks, getVideoTracks: () => [tracks[0]], tracks };
                    media.streams.push(stream); return stream;
                };
                Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getDisplayMedia: async options => {
                    media.prompts++; media.options.push(options);
                    if (media.permission === 'cancel') throw new DOMException('Permission denied', 'NotAllowedError');
                    if (media.permission === 'pending') return new Promise((resolve, reject) => {
                        window.resolvePermission = () => resolve(fakeStream()); window.rejectPermission = () => reject(new DOMException('Permission denied', 'NotAllowedError'));
                    });
                    return fakeStream();
                } } });
                const sources = new WeakMap();
                Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', { configurable: true, get() { return sources.get(this) || null; }, set(value) { sources.set(this, value); } });
                HTMLMediaElement.prototype.pause = function () { this.pauses = (this.pauses || 0) + 1; };
                HTMLMediaElement.prototype.play = function () {
                    media.videos.push(this);
                    return media.play === 'pending' ? new Promise(resolve => { window.resolvePlayback = resolve; }) : Promise.resolve();
                };
                let fullscreen = null;
                Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreen });
                Object.defineProperty(document.documentElement, 'requestFullscreen', { configurable: true, value: async () => {
                    fullscreen = document.documentElement; document.dispatchEvent(new Event('fullscreenchange'));
                } });
                Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: async () => {
                    fullscreen = null; document.dispatchEvent(new Event('fullscreenchange'));
                } });
                window.examStarts = 0; window.questionLoads = 0; window.detailLoads = 0;
                window.savedAnswers = []; window.securityEvents = []; window.submissions = 0; window.starts = 0;
                window.securityQueue = []; window.captureRequests = 0;
                window.evidenceServer = { status: 'in_progress', events: {}, images: {}, logs: [], manifests: [], answerPayloads: [], uploads: [], rejectedLateEvents: [], removedEvents: [] };
                const evidenceServer = window.evidenceServer;
                const pendingEvidenceUploads = [];
                window.releaseEvidenceUpload = () => {
                    if (evidence) evidence.upload = 'success';
                    pendingEvidenceUploads.splice(0).forEach(resolve => resolve());
                };
                let eventSequence = 0;
                let releaseSubmitted;
                const submitted = new Promise(resolve => { releaseSubmitted = resolve; });
                const eventId = event => event.clientEventId || event.id;
                const acknowledgeLog = (attemptId, eventType, metadata, id) => {
                    const duplicate = Boolean(evidenceServer.events[id]);
                    evidenceServer.logs.push({ attemptId, eventType, metadata, id, duplicate, status: evidenceServer.status });
                    if (evidenceServer.status !== 'in_progress' && !duplicate) {
                        evidenceServer.rejectedLateEvents.push(id);
                        return { success: false, retryable: false, error: 'attempt already submitted' };
                    }
                    if (!duplicate) evidenceServer.events[id] = { clientEventId: id, eventType, metadata };
                    return { success: true, warningCount: Object.keys(evidenceServer.events).length, maxViolations: 3, terminated: false, duplicate };
                };
                const exam = { id: 'test-exam', title: 'Ujian Berbagi Layar', duration_minutes: 60,
                    metadata: { is_safe_mode: true, screenshot_enabled: true } };
                const cachedSession = offlineSession ? {
                    attemptId: 'attempt', examId: exam.id, deviceId: 'test-device',
                    user: { id: 'student', email: 'student@example.invalid' }, profile: null,
                    exam: { ...exam, metadata: { is_safe_mode: true, screenshot_enabled: false } },
                    attempt: { id: 'attempt', status: 'in_progress', warning_count: 0 },
                    questions: [{ id: 'q', type: 'essay', content: 'Soal Uji', bank_question_options: [] }],
                    deadlineAt: Date.now() + remainingSeconds * 1000, lastQuestionIndex: 0,
                } : null;
                const router = { push: value => { window.destination = value; } };
                const toast = { success: noop, warning: noop, error: noop };
                const params = { id: exam.id };
                const detailsPending = new Promise(resolve => { window.releaseDetails = resolve; });
                const stubs = {
                    'next/navigation': { useParams: () => params, useRouter: () => router },
                    '@/app/components/ui/Toast': { useToast: () => toast },
                    '@/lib/session': { getSessionUser: async () => {
                        if (authFailure) throw new Error('Temporary session endpoint failure');
                        return { id: 'student', email: 'student@example.invalid' };
                    } },
                    '@/lib/device-id': { getDeviceId: () => 'test-device', setDeviceId: noop },
                    '@/lib/exam-editor-lock': { acquireExamEditorLock: async () => noop },
                    '@/lib/exam-pwa': { isExamPwaEnabled: () => false, cacheExamOfflineShell: asyncNoop, removeExamOfflineShell: asyncNoop },
                    '@/lib/exam-wake-lock': { keepExamScreenAwake: () => noop },
                    '@/lib/monitoring-health': { formatStudentName: value => value },
                    '@/lib/errors': { getErrorMessage: error => error.message },
                    '@/lib/exam-network': { sampleExamNetwork: () => ({ weak: false }), examNetworkLabel: () => '' },
                    '@/lib/exam-retry': { examAutoRetryDelay: () => 1000 },
                    '@/lib/api/client': { apiSend: async (url, payload) => {
                        if (!url.endsWith('/screenshots')) return { success: true };
                        const record = { url, ...payload, status: evidenceServer.status };
                        evidenceServer.uploads.push(record);
                        if (!evidenceServer.events[payload.clientEventId]) return { success: false, retryable: false, error: 'event not registered' };
                        if (evidence?.upload === 'pending') await new Promise(resolve => { pendingEvidenceUploads.push(resolve); });
                        if (evidence?.upload === 'retry-failure') return { success: false, retryable: true, error: 'temporary evidence outage' };
                        record.saved = true;
                        evidenceServer.images[payload.clientEventId] ||= payload.imageBase64;
                        return { success: true, saved: true };
                    } },
                    '@/lib/api/proctoring': {
                        heartbeatExamAttempt: async () => ({ success: true }),
                        logSecurityViolation: async (...args) => {
                            if (evidence?.logs === 'after-submit' && evidenceServer.status === 'in_progress') await submitted;
                            return acknowledgeLog(...args);
                        },
                    },
                    '@/lib/exam-durable-storage': new Proxy({
                        inspectExamStorage: async () => ({ available: true, mode: 'indexeddb' }),
                        resolveDurableDeviceId: async id => id,
                        readExamSnapshot: async () => offlineSession ? { answers: { q: 'Jawaban lokal' }, doubtfulAnswers: [], revisions: { q: 1 } } : null,
                        readExamRecoverySession: async () => cachedSession,
                        readSecurityEvents: async attemptId => window.securityQueue.filter(event => event.attemptId === attemptId).map(event => ({ ...event })),
                        validateExamRecoverySession: () => cachedSession ? { valid: true, session: cachedSession } : { valid: false },
                        freezeExamSnapshot: async (_id, snapshot) => snapshot,
                        writeExamSnapshot: async () => ({ saved: true, mode: 'indexeddb' }),
                        createSecurityEventId: () => '00000000-0000-4000-8000-' + String(++eventSequence).padStart(12, '0'),
                        enqueueSecurityEvent: async event => {
                            const index = window.securityQueue.findIndex(queued => queued.id === event.id);
                            if (index >= 0) window.securityQueue[index] = { ...window.securityQueue[index], ...event };
                            else window.securityQueue.push({ ...event });
                            if (!window.securityEvents.some(queued => queued.id === event.id)) window.securityEvents.push({ ...event });
                            return { saved: true, mode: 'indexeddb' };
                        },
                        removeSecurityEvent: async (attemptId, id, expected) => {
                            const current = window.securityQueue.find(event => event.attemptId === attemptId && event.id === id);
                            if (expected && current && current.screenshotBase64 !== expected.screenshotBase64) return;
                            evidenceServer.removedEvents.push(id);
                            window.securityQueue = window.securityQueue.filter(event => event.attemptId !== attemptId || event.id !== id);
                        },
                        ExamSnapshotConflictError: class extends Error {},
                    }, { get: (target, key) => target[key] || asyncNoop }),
                    '@/lib/api/students': {
                        getExamForAttempt: async () => {
                            window.detailLoads++;
                            if (holdDetails && window.detailLoads === 2) await detailsPending;
                            return { success: true, exam, profile: null, hasStartedAttempt: false };
                        },
                        startExamAttemptAction: async () => {
                            window.examStarts++;
                            return { success: true, attempt: { id: 'attempt', status: 'in_progress', started_at: new Date().toISOString(),
                                personal_end_time: new Date(Date.now() + remainingSeconds * 1000).toISOString() }, answers: [], remainingSeconds };
                        },
                        getExamQuestionsAction: async () => {
                            window.questionLoads++;
                            return { success: true, questions: [{ id: 'q', type: 'essay', content: 'Soal Uji', bank_question_options: [] }] };
                        },
                        saveAnswerAction: async (...args) => { window.savedAnswers.push(args); return { success: true }; },
                        syncAnswersBulkAction: async () => ({ success: true }),
                        submitExamAction: async (...args) => {
                            window.submissions++;
                            const manifest = args[6] || [];
                            evidenceServer.manifests.push(manifest);
                            evidenceServer.answerPayloads.push({ ...args[1] });
                            if (window.rejectNextSubmission) {
                                window.rejectNextSubmission = false;
                                return { success: false, retryable: false, error: 'Pengumpulan perlu diverifikasi kembali.' };
                            }
                            for (const event of manifest) evidenceServer.events[eventId(event)] ||= { ...event };
                            // Match the server transaction: register the manifest before closing the attempt.
                            evidenceServer.status = 'submitted'; releaseSubmitted();
                            return { success: true };
                        },
                    },
                };
                const require = name => {
                    name = ({ './api/client': '@/lib/api/client', './api/proctoring': '@/lib/api/proctoring',
                        './device-id': '@/lib/device-id', './exam-durable-storage': '@/lib/exam-durable-storage',
                        './exam-screenshots': '@/lib/exam-screenshots' })[name] || name;
                    if (name === 'lucide-react') return new Proxy({}, { get: () => () => null });
                    if (name === '@/app/components/ui/SkeletonPatterns') return { ExamPageSkeleton: () => require('react').createElement('p', {}, 'Memuat ujian') };
                    if (name === './ExamViewer') return { ExamViewer: props => {
                        window.viewer = props;
                        return require('react').createElement('div', { 'data-testid': 'exam-viewer' },
                            require('react').createElement('input', { 'aria-label': 'Jawaban', value: props.answers.q || '', onChange: e => props.onAnswerChange('q', e.target.value) }),
                            require('react').createElement('button', { onClick: () => props.onSubmitExam() }, 'Kumpulkan Ujian'));
                    } };
                    if (stubs[name]) return stubs[name];
                    if (!modules[name]) return {};
                    if (!cache[name]) {
                        const module = { exports: {} }; cache[name] = module;
                        new Function('module', 'exports', 'require', 'process', modules[name])(module, module.exports, require, { env: { NODE_ENV: 'development' } });
                        if (name === '@/lib/exam-screenshots' && evidence) module.exports.encodeScreenFrame = async () => {
                            window.captureRequests++;
                            if (evidence.capture === 'pending') await new Promise(resolve => { window.releaseEvidenceCapture = resolve; });
                            return new Blob(['isolated screenshot evidence'], { type: 'image/webp' });
                        };
                    }
                    return cache[name].exports;
                };
                const React = require('react');
                function Harness(props) {
                    const share = require('@/hooks/useExamScreenshots').useExamScreenshots(props.examId, props.completed);
                    window.hook = share;
                    if (component === 'preparation') return React.createElement(require('./ExamStartPreparation').ExamStartPreparation, {
                        exam, onConfirm: () => { window.starts++; }, onBack: noop,
                        screenShare: { ...share, request: share.requestShare },
                    });
                    return React.createElement('output', { 'data-testid': 'hook-state' }, JSON.stringify({ sharing: share.sharing, ref: share.sharingRef.current, busy: share.busy, error: share.error }));
                }
                const container = document.createElement('div'); document.body.append(container);
                const root = require('react-dom/client').createRoot(container);
                window.renderHook = (examId = 'test-exam', completed = false) => root.render(React.createElement(Harness, { examId, completed }));
                window.unmountHook = () => root.unmount();
                window.encodeScreenFrame = require('@/lib/exam-screenshots').encodeScreenFrame;
                if (component === 'exam') root.render(React.createElement(require('ExamPage').default));
                else window.renderHook();
            }, { modules, component, surface, permission, play, holdDetails, remainingSeconds, evidence, authFailure, offlineSession });
            if ((component === 'exam' && !offlineSession) || component === 'preparation') await page.getByRole('heading', { name: 'Persiapan Ujian' }).waitFor();
            else if (component === 'hook') await page.getByTestId('hook-state').waitFor();
        }
        async function requestShare() {
            await page.evaluate(() => { window.sharePromise = window.hook.requestShare(); });
        }
        async function state() {
            return page.evaluate(() => ({ sharing: window.hook.sharing, ref: window.hook.sharingRef.current, busy: window.hook.busy,
                prompts: window.testMedia.prompts, error: window.hook.error,
                tracks: window.testMedia.streams.flatMap(stream => stream.tracks.map(track => ({ state: track.readyState, stops: track.stops }))),
                videos: window.testMedia.videos.map(video => ({ detached: video.srcObject === null, pauses: video.pauses || 0 })) }));
        }
        async function expectSharing(sharing) {
            await page.waitForFunction(expected => window.hook.sharing === expected && window.hook.sharingRef.current === expected, sharing);
        }
        async function expectStopped() {
            const result = await state();
            assert.equal(result.ref, false);
            assert.ok(result.tracks.every(track => track.state === 'ended'), 'every returned track must be stopped');
            assert.ok(result.videos.every(video => video.detached && video.pauses > 0), 'all playback elements must be paused and detached');
        }
        async function test(name, run) {
            try { await run(); assert.deepEqual(pageErrors, [], 'no unhandled browser exceptions'); console.log('PASS: ' + name); }
            catch (error) { failures.push({ name, error }); console.error('FAIL: ' + name + '\n' + error.stack); }
        }

        await test('entire-screen permission is accepted once and browser Stop allows sharing again', async () => {
            await mount(); await requestShare(); await expectSharing(true);
            assert.equal((await state()).prompts, 1);
            assert.deepEqual(await page.evaluate(() => window.testMedia.options[0]), { video: { displaySurface: 'monitor' }, audio: false, monitorTypeSurfaces: 'include' });
            await requestShare(); assert.equal((await state()).prompts, 1, 'an active share must not open another permission prompt');
            await page.evaluate(() => window.testMedia.streams[0].tracks[0].end());
            await expectSharing(false); await expectStopped();
            await requestShare(); await expectSharing(true); assert.equal((await state()).prompts, 2);
        });
        for (const surface of ['browser', 'window']) await test(surface + ' capture is rejected and every returned track is closed', async () => {
            await mount({ surface }); await requestShare();
            await page.waitForFunction(() => !window.hook.busy && window.hook.error.length > 0);
            await expectSharing(false); await expectStopped();
            assert.match((await state()).error, /Seluruh Layar/);
        });
        await test('unverified capture surface is rejected and requires a proctor exception', async () => {
            await mount({ surface: null }); await requestShare();
            await page.waitForFunction(() => !window.hook.busy && window.hook.error.length > 0);
            await expectSharing(false); await expectStopped();
            assert.match((await state()).error, /memverifikasi.*Seluruh Layar/);
        });
        await test('temporary capture mute blocks sharing and unmute restores the same stream', async () => {
            await mount(); await requestShare(); await expectSharing(true);
            await page.evaluate(() => window.testMedia.streams[0].tracks[0].setMuted(true));
            await expectSharing(false);
            assert.equal((await state()).tracks[0].state, 'live');
            await page.evaluate(() => window.testMedia.streams[0].tracks[0].setMuted(false));
            await expectSharing(true); assert.equal((await state()).prompts, 1);
            assert.equal((await state()).error, '');
        });
        await test('completion stops all tracks and clears both React state and synchronous sharing ref', async () => {
            await mount(); await requestShare(); await expectSharing(true);
            await page.evaluate(() => window.renderHook('test-exam', true));
            await expectSharing(false); await expectStopped();
            await requestShare(); assert.equal((await state()).prompts, 1, 'a completed exam cannot restart sharing');
        });
        await test('manual lifecycle stop clears status and releases playback', async () => {
            await mount(); await requestShare(); await expectSharing(true);
            await page.evaluate(() => window.hook.stop()); await expectSharing(false); await expectStopped();
        });
        for (const transition of ['completion', 'unmount', 'exam-change']) await test('late permission after ' + transition + ' is discarded', async () => {
            await mount({ permission: 'pending' }); await requestShare();
            await page.waitForFunction(() => window.testMedia.prompts === 1);
            await page.evaluate(transition => {
                if (transition === 'unmount') window.unmountHook();
                else window.renderHook(transition === 'exam-change' ? 'another-exam' : 'test-exam', transition === 'completion');
            }, transition);
            await page.waitForTimeout(20);
            await page.evaluate(() => window.resolvePermission());
            await page.evaluate(() => window.sharePromise);
            if (transition !== 'unmount') await expectSharing(false);
            await expectStopped();
        });
        await test('stop while preview.play is pending discards and detaches the preview', async () => {
            await mount({ play: 'pending' }); await requestShare();
            await page.waitForFunction(() => window.testMedia.videos.length === 1);
            await page.evaluate(() => window.hook.stop());
            await expectStopped();
            await page.evaluate(() => window.resolvePlayback()); await page.evaluate(() => window.sharePromise);
            await expectSharing(false); await expectStopped();
        });
        await test('canceling native permission never enables or starts the exam', async () => {
            await mount({ component: 'preparation', permission: 'cancel' });
            await page.getByRole('button', { name: 'Aktifkan Layar Penuh', exact: true }).click();
            await page.getByRole('button', { name: 'Bagikan Seluruh Layar', exact: true }).click();
            await page.getByRole('alert').waitFor();
            assert.equal(await page.getByRole('button', { name: 'Ya, Mulai Ujian', exact: true }).isDisabled(), true);
            assert.equal(await page.evaluate(() => window.starts), 0);
            await page.evaluate(() => { window.testMedia.permission = 'success'; });
            await page.getByRole('button', { name: 'Bagikan Seluruh Layar', exact: true }).click();
            await expectSharing(true);
            assert.equal(await page.evaluate(() => window.starts), 0);
            await page.getByRole('button', { name: 'Ya, Mulai Ujian', exact: true }).click();
            assert.equal(await page.evaluate(() => window.starts), 1);
        });
        await test('temporary auth endpoint failure restores the validated local exam while the browser reports online', async () => {
            await mount({ component: 'exam', authFailure: true, offlineSession: true });
            await page.getByTestId('exam-viewer').waitFor();
            assert.equal(await page.getByRole('textbox', { name: 'Jawaban', exact: true }).inputValue(), 'Jawaban lokal');
            assert.equal(await page.evaluate(() => window.detailLoads), 0, 'exam detail must not be required before local recovery');
            assert.equal(await page.evaluate(() => navigator.onLine), true);
            assert.equal(await page.getByRole('heading', { name: 'Ujian Belum Dapat Dibuka' }).count(), 0);
        });
        await test('Mac command shortcuts are blocked and recorded during the exam', async () => {
            await mount({ component: 'exam' });
            await page.getByRole('button', { name: 'Aktifkan Layar Penuh', exact: true }).click();
            await page.getByRole('button', { name: 'Bagikan Seluruh Layar', exact: true }).click();
            await page.getByRole('button', { name: 'Ya, Mulai Ujian', exact: true }).click();
            await page.getByTestId('exam-viewer').waitFor();
            const prevented = await page.evaluate(() => {
                const event = new KeyboardEvent('keydown', { key: 'C', metaKey: true, bubbles: true, cancelable: true });
                window.dispatchEvent(event);
                return event.defaultPrevented;
            });
            assert.equal(prevented, true);
            await page.waitForFunction(() => window.securityEvents.some(event => event.eventType === 'restricted_shortcut'));
        });
        await test('real ExamPage rechecks sharing before start and automatically stops after successful submission', async () => {
            await mount({ component: 'exam', holdDetails: true });
            await page.getByRole('button', { name: 'Aktifkan Layar Penuh', exact: true }).click();
            await page.getByRole('button', { name: 'Bagikan Seluruh Layar', exact: true }).click();
            await page.getByRole('button', { name: 'Ya, Mulai Ujian', exact: true }).click();
            await page.waitForFunction(() => window.detailLoads === 2);
            await page.evaluate(() => { window.testMedia.streams[0].tracks[0].end(); window.releaseDetails(); });
            await page.getByRole('heading', { name: 'Persiapan Ujian' }).waitFor();
            assert.equal(await page.evaluate(() => window.examStarts), 0);
            await page.getByRole('button', { name: 'Aktifkan Layar Penuh', exact: true }).click();
            await page.getByRole('button', { name: 'Bagikan Seluruh Layar', exact: true }).click();
            await page.getByRole('button', { name: 'Ya, Mulai Ujian', exact: true }).click();
            await page.getByTestId('exam-viewer').waitFor();
            assert.equal(await page.evaluate(() => window.examStarts), 1);
            await page.getByRole('textbox', { name: 'Jawaban', exact: true }).fill('Jawaban tersimpan');
            await page.waitForFunction(() => window.savedAnswers.length === 1);
            await page.evaluate(() => { window.beforeStopViewer = window.viewer; window.testMedia.streams[1].tracks[0].end(); });
            await page.getByRole('dialog', { name: 'Bagikan kembali layar', exact: true }).waitFor();
            assert.equal(await page.getByTestId('exam-viewer').evaluate(element => element.parentElement.inert), true);
            await page.evaluate(async () => {
                const viewer = window.beforeStopViewer;
                await viewer.onAnswerChange('q', 'Perubahan terlarang');
                await viewer.onToggleDoubtful('q');
                viewer.onNavigate(1); viewer.onAssignmentTextChange('Perubahan terlarang');
                await viewer.onSubmitExam();
            });
            assert.equal(await page.evaluate(() => window.savedAnswers.length), 1);
            assert.equal(await page.evaluate(() => window.viewer.answers.q), 'Jawaban tersimpan');
            assert.equal(await page.evaluate(() => window.viewer.doubtfulAnswers.has('q')), false);
            assert.equal(await page.evaluate(() => window.viewer.currentQIndex), 0);
            assert.equal(await page.evaluate(() => window.viewer.assignmentTextNote), '');
            assert.equal(await page.evaluate(() => window.submissions), 0);
            await page.getByRole('button', { name: 'Bagikan Layar', exact: true }).click();
            await page.getByRole('textbox', { name: 'Jawaban', exact: true }).waitFor();
            assert.equal(await page.evaluate(() => window.examStarts), 1);
            await page.getByRole('button', { name: 'Kumpulkan Ujian', exact: true }).click();
            await page.waitForFunction(() => window.submissions === 1 && window.destination === '/dashboard/siswa/results');
            await page.waitForFunction(() => window.testMedia.streams.every(stream => stream.tracks.every(track => track.readyState === 'ended')));
            assert.ok(await page.evaluate(() => window.testMedia.videos.every(video => video.srcObject === null && video.pauses > 0)));
            assert.equal(await page.evaluate(() => window.securityEvents.filter(event => event.eventType === 'SCREEN_SHARE_STOPPED').length), 1,
                'the completed exam must not emit a second stopped-sharing violation');
        });
        await test('real ExamPage countdown and automatic submission continue while sharing is stopped', async () => {
            await mount({ component: 'exam', remainingSeconds: 2 });
            await page.getByRole('button', { name: 'Aktifkan Layar Penuh', exact: true }).click();
            await page.getByRole('button', { name: 'Bagikan Seluruh Layar', exact: true }).click();
            await page.getByRole('button', { name: 'Ya, Mulai Ujian', exact: true }).click();
            await page.getByTestId('exam-viewer').waitFor();
            assert.equal(await page.evaluate(() => window.viewer.timeLeft), 2);
            await page.evaluate(() => { window.beforeStopViewer = window.viewer; window.testMedia.streams[0].tracks[0].end(); });
            await page.getByRole('dialog', { name: 'Bagikan kembali layar', exact: true }).waitFor();
            await page.evaluate(() => window.beforeStopViewer.onSubmitExam());
            assert.equal(await page.evaluate(() => window.submissions), 0, 'manual submission must remain blocked');
            await page.waitForFunction(() => window.viewer.timeLeft === 1 && window.submissions === 0);
            assert.equal(await page.getByTestId('exam-viewer').evaluate(element => element.parentElement.inert), true);
            await page.waitForFunction(() => window.submissions === 1 && window.destination === '/dashboard/siswa/results');
            assert.equal(await page.evaluate(() => window.viewer.timeLeft), 0);
            assert.equal(await page.evaluate(() => window.examStarts), 1);
            assert.ok(await page.evaluate(() => window.testMedia.streams.every(stream => stream.tracks.every(track => track.readyState === 'ended'))));
            assert.ok(await page.evaluate(() => window.testMedia.videos.every(video => video.srcObject === null && video.pauses > 0)));
            assert.equal(await page.evaluate(() => window.securityEvents.filter(event => event.eventType === 'SCREEN_SHARE_STOPPED').length), 1,
                'only the actual browser stop is logged, with no additional stop on automatic completion');
        });
        await test('a manual retry delivers frozen answers after sharing stops without reopening editing', async () => {
            await mount({ component: 'exam' });
            await page.getByRole('button', { name: 'Aktifkan Layar Penuh', exact: true }).click();
            await page.getByRole('button', { name: 'Bagikan Seluruh Layar', exact: true }).click();
            await page.getByRole('button', { name: 'Ya, Mulai Ujian', exact: true }).click();
            await page.getByTestId('exam-viewer').waitFor();
            await page.getByRole('textbox', { name: 'Jawaban', exact: true }).fill('Jawaban akhir terkunci');
            await page.waitForFunction(() => window.savedAnswers.length === 1);
            await page.evaluate(() => { window.rejectNextSubmission = true; window.beforeSubmitViewer = window.viewer; });
            await page.getByRole('button', { name: 'Kumpulkan Ujian', exact: true }).click();
            await page.getByRole('heading', { name: 'Pengumpulan Perlu Diperiksa', exact: true }).waitFor();
            assert.equal(await page.evaluate(() => window.submissions), 1);
            await page.evaluate(async () => {
                window.testMedia.streams[0].tracks[0].end();
                await window.beforeSubmitViewer.onAnswerChange('q', 'Perubahan terlarang');
                await window.beforeSubmitViewer.onToggleDoubtful('q');
            });
            assert.equal(await page.getByRole('dialog', { name: 'Bagikan kembali layar', exact: true }).count(), 0,
                'a frozen submission must not need a fresh screen-sharing session');
            await page.getByRole('button', { name: 'Periksa dan Kirim Ulang', exact: true }).click();
            await page.waitForFunction(() => window.submissions === 2 && window.destination === '/dashboard/siswa/results');
            assert.deepEqual(await page.evaluate(() => window.evidenceServer.answerPayloads), [
                { q: 'Jawaban akhir terkunci' }, { q: 'Jawaban akhir terkunci' },
            ]);
            assert.equal(await page.evaluate(() => window.savedAnswers.length), 1);
            assert.equal(await page.evaluate(() => window.testMedia.prompts), 1);
        });
        await test('real frame encoder freezes video once before asynchronous encoding and resizing', async () => {
            await mount();
            const result = await page.evaluate(async () => {
                const video = { videoWidth: 1920, videoHeight: 1080 };
                const draws = []; let encodings = 0;
                HTMLCanvasElement.prototype.getContext = function () {
                    const target = this;
                    return { drawImage: source => draws.push({ source: source === video ? 'video' : 'canvas',
                        sourceWidth: source === video ? source.videoWidth : source.width,
                        sourceHeight: source === video ? source.videoHeight : source.height,
                        width: target.width, height: target.height }) };
                };
                HTMLCanvasElement.prototype.toBlob = function (callback, mime) {
                    encodings++;
                    video.videoWidth = 0; video.videoHeight = 0;
                    const size = encodings <= 6 ? 200 * 1024 + 1 : 128;
                    setTimeout(() => callback(new Blob([new Uint8Array(size)], { type: mime })), 0);
                };
                const blob = await window.encodeScreenFrame(video);
                return { draws, encodings, bytes: blob.size, mime: blob.type };
            });
            assert.equal(result.draws.filter(draw => draw.source === 'video').length, 1);
            assert.equal(result.encodings, 7, 'oversized first encodings must exercise the smaller-size fallback');
            assert.deepEqual(result.draws.map(draw => draw.width), [1600, 1600, 1280]);
            assert.ok(result.draws.every(draw => draw.sourceWidth > 0 && draw.sourceHeight > 0 && draw.width > 0 && draw.height > 0));
            assert.equal(result.bytes, 128); assert.equal(result.mime, 'image/webp');
        });
        async function startEvidenceExam(upload) {
            await mount({ component: 'exam', evidence: { capture: 'pending', upload, logs: 'after-submit' } });
            await page.getByRole('button', { name: 'Aktifkan Layar Penuh', exact: true }).click();
            await page.getByRole('button', { name: 'Bagikan Seluruh Layar', exact: true }).click();
            await page.getByRole('button', { name: 'Ya, Mulai Ujian', exact: true }).click();
            await page.getByTestId('exam-viewer').waitFor();
            await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'PrintScreen', bubbles: true })));
            await page.waitForFunction(() => window.captureRequests === 1 && window.securityEvents.length === 1);
            await page.evaluate(() => { window.evidenceSubmitPromise = window.viewer.onSubmitExam(); });
            await page.waitForFunction(() => window.submissions === 1 && window.destination === '/dashboard/siswa/results', null, { timeout: 1500 });
            const manifest = await page.evaluate(() => window.evidenceServer.manifests[0]);
            assert.equal(manifest.length, 1, 'the in-flight capture must already have a descriptor in the submission manifest');
            assert.equal(manifest[0].eventType, 'restricted_shortcut');
            const id = manifest[0].id;
            assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
            assert.equal(id, await page.evaluate(() => window.securityEvents[0].id));
            assert.equal(manifest[0].screenshotBase64, undefined, 'submission must not carry the image payload');
            assert.equal(await page.evaluate(() => window.evidenceServer.uploads.length), 0, 'answers must submit before capture is released');
            await page.evaluate(() => window.unmountHook());
            assert.ok(await page.evaluate(() => window.testMedia.streams.every(stream => stream.tracks.every(track => track.readyState === 'ended'))));
            await page.evaluate(() => window.releaseEvidenceCapture());
            return id;
        }
        await test('in-flight screenshot event is registered atomically with answers and uploads after submit/unmount', async () => {
            const id = await startEvidenceExam('pending');
            await page.waitForFunction(() => window.evidenceServer.uploads.length >= 1);
            const waiting = await page.evaluate(() => ({
                logs: window.evidenceServer.logs, queue: window.securityQueue, uploads: window.evidenceServer.uploads,
                rejected: window.evidenceServer.rejectedLateEvents,
            }));
            assert.ok(waiting.logs.some(log => log.id === id && log.duplicate && log.status === 'submitted'), 'late log must receive the registered-event duplicate acknowledgement');
            assert.ok(waiting.queue.some(event => event.id === id && event.screenshotBase64), 'retain the image locally until its upload is acknowledged');
            assert.equal(waiting.uploads[0].status, 'submitted');
            assert.equal(waiting.uploads[0].clientEventId, id);
            assert.deepEqual(waiting.rejected, []);
            await page.evaluate(() => window.releaseEvidenceUpload());
            await page.waitForFunction(() => window.securityQueue.length === 0 && window.evidenceServer.uploads[0].saved === true);
            assert.equal(await page.evaluate(() => Object.keys(window.evidenceServer.events).length), 1);
            assert.equal(await page.evaluate(() => Object.keys(window.evidenceServer.images).length), 1);
            assert.equal(await page.evaluate(() => window.submissions), 1);
        });
        await test('retryable screenshot outage preserves local evidence while answers still submit immediately', async () => {
            const id = await startEvidenceExam('retry-failure');
            await page.waitForFunction(() => window.evidenceServer.uploads.length >= 3, null, { timeout: 6000 });
            const result = await page.evaluate(() => ({
                status: window.evidenceServer.status, queue: window.securityQueue, submissions: window.submissions,
                uploads: window.evidenceServer.uploads, logs: window.evidenceServer.logs,
                rejected: window.evidenceServer.rejectedLateEvents,
            }));
            assert.equal(result.status, 'submitted'); assert.equal(result.submissions, 1);
            assert.ok(result.queue.some(event => event.id === id && event.screenshotBase64), 'failed image retries must keep the durable local evidence');
            assert.ok(result.uploads.every(upload => upload.clientEventId === id && upload.status === 'submitted' && !upload.saved));
            assert.ok(result.logs.some(log => log.id === id && log.duplicate));
            assert.deepEqual(result.rejected, []);
        });
        await test('reconnection submits frozen offline answers without waiting for an existing image upload', async () => {
            await mount({ component: 'exam', evidence: { capture: 'success', upload: 'pending' } });
            await page.getByRole('button', { name: 'Aktifkan Layar Penuh', exact: true }).click();
            await page.getByRole('button', { name: 'Bagikan Seluruh Layar', exact: true }).click();
            await page.getByRole('button', { name: 'Ya, Mulai Ujian', exact: true }).click();
            await page.getByTestId('exam-viewer').waitFor();
            await page.getByRole('textbox', { name: 'Jawaban', exact: true }).fill('Jawaban sebelum koneksi terputus');
            await page.waitForFunction(() => window.savedAnswers.length === 1);
            await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'PrintScreen', bubbles: true })));
            await page.waitForFunction(() => window.evidenceServer.uploads.length === 1);
            await page.evaluate(async () => {
                window.testOnline = false;
                Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => window.testOnline });
                window.dispatchEvent(new Event('offline'));
                await window.viewer.onSubmitExam();
            });
            await page.getByRole('heading', { name: 'Menunggu Konfirmasi Pengumpulan', exact: true }).waitFor();
            assert.equal(await page.evaluate(() => window.submissions), 0);
            assert.equal(await page.evaluate(() => window.evidenceServer.uploads.some(upload => upload.saved)), false);
            await page.evaluate(() => { window.testOnline = true; window.dispatchEvent(new Event('online')); });
            await page.waitForFunction(() => window.submissions === 1 && window.destination === '/dashboard/siswa/results', null, { timeout: 1500 });
            const pending = await page.evaluate(() => ({
                manifest: window.evidenceServer.manifests[0], answers: window.evidenceServer.answerPayloads[0],
                queue: window.securityQueue, uploads: window.evidenceServer.uploads,
            }));
            assert.deepEqual(pending.answers, { q: 'Jawaban sebelum koneksi terputus' });
            assert.equal(pending.manifest.length, 1);
            assert.equal(pending.manifest[0].eventType, 'restricted_shortcut');
            assert.equal(pending.manifest[0].id, pending.queue[0].id);
            assert.ok(pending.queue[0].screenshotBase64, 'keep the pending image across offline submission and reconnection');
            assert.equal(pending.uploads.some(upload => upload.saved), false, 'answer retry must finish while image uploads remain pending');
            await page.evaluate(() => window.releaseEvidenceUpload());
            await page.waitForFunction(() => window.securityQueue.length === 0 && Object.keys(window.evidenceServer.images).length === 1);
            assert.equal(await page.evaluate(() => window.submissions), 1);
            assert.deepEqual(await page.evaluate(() => window.evidenceServer.rejectedLateEvents), []);
        });
        if (failures.length) throw new Error(failures.length + ' browser regression(s) failed: ' + failures.map(item => item.name).join('; '));
        console.log('All screen-sharing browser regressions passed; no API or database calls were made.');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
