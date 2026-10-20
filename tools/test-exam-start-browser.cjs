// Isolated browser test of the real preparation component; no API or database access.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ts = require('typescript');
const { chromium } = require('playwright');

(async () => {
    const executablePath = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
        'C:/Program Files/Google/Chrome/Application/chrome.exe', chromium.executablePath()].find(fs.existsSync);
    const browser = await chromium.launch({ executablePath, headless: true });
    try {
        const page = await browser.newPage();
        page.on('pageerror', error => console.error('Exam browser error:', error.message));
        const modules = {};
        for (const [name, pkg, file] of [
            ['react', 'react', 'react.development.js'],
            ['react-dom', 'react-dom', 'react-dom.development.js'],
            ['react-dom/client', 'react-dom', 'react-dom-client.development.js'],
            ['react/jsx-runtime', 'react', 'react-jsx-runtime.development.js'],
            ['scheduler', 'scheduler', 'scheduler.development.js'],
        ]) {
            modules[name] = fs.readFileSync(path.join(path.dirname(require.resolve(pkg)), 'cjs', file), 'utf8');
        }
        const component = ts.transpileModule(fs.readFileSync('apps/web/app/components/questions/ExamStartPreparation.tsx', 'utf8'), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
        }).outputText;
        for (const [name, file] of [
            ['@/lib/exam-fullscreen', 'apps/web/lib/exam-fullscreen.ts'],
            ['@/lib/exam-clock', 'apps/web/lib/exam-clock.ts'],
            ['@/lib/per-key-queue', 'apps/web/lib/per-key-queue.ts'],
            ['./ExamStartPreparation', 'apps/web/app/components/questions/ExamStartPreparation.tsx'],
            ['ExamPage', 'apps/web/app/components/questions/ExamPage.tsx'],
        ]) {
            modules[name] = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
                compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
            }).outputText;
        }
        async function mount(mode = 'success') {
            await page.goto('about:blank');
            await page.evaluate(({ modules, component, mode }) => {
                const cache = {};
                const require = name => {
                    if (name === 'lucide-react') return { AlertTriangle: () => null, Maximize2: () => null, ShieldCheck: () => null };
                    if (!cache[name]) {
                        const module = { exports: {} }; cache[name] = module;
                        new Function('module', 'exports', 'require', 'process', modules[name])(module, module.exports, require, { env: { NODE_ENV: 'development' } });
                    }
                    return cache[name].exports;
                };
                const exports = {};
                new Function('exports', 'require', component)(exports, require);
                let fullscreen = null;
                Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreen });
                Object.defineProperty(document.documentElement, 'requestFullscreen', { configurable: true, value: mode === 'unsupported' ? undefined : async () => {
                    if (mode === 'denied') throw new Error('denied');
                    fullscreen = document.documentElement;
                    document.dispatchEvent(new Event('fullscreenchange'));
                } });
                if (mode === 'unsupported') {
                    Object.defineProperty(document.documentElement, 'webkitRequestFullscreen', { configurable: true, value: undefined });
                    Object.defineProperty(document.documentElement, 'msRequestFullscreen', { configurable: true, value: undefined });
                }
                window.exitTestFullscreen = () => { fullscreen = null; document.dispatchEvent(new Event('fullscreenchange')); };
                Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: async () => { window.exitTestFullscreen(); } });
                window.starts = 0; window.backs = 0;
                const root = document.createElement('div'); document.body.append(root);
                require('react-dom/client').createRoot(root).render(require('react').createElement(exports.ExamStartPreparation, {
                    exam: { title: 'Ujian Matematika', duration_minutes: 60 },
                    onConfirm: () => { window.starts++; }, onBack: () => { window.backs++; },
                }));
            }, { modules, component, mode });
            await page.getByRole('heading', { name: 'Persiapan Ujian' }).waitFor();
        }
        await mount();
        assert.equal(await page.evaluate(() => window.starts), 0);
        assert.equal(await page.getByRole('button', { name: 'Ya, Mulai Ujian' }).count(), 0);
        await page.getByRole('button', { name: 'Aktifkan Layar Penuh', exact: true }).click();
        await page.getByRole('heading', { name: 'Yakin ingin memulai ujian?' }).waitFor();
        assert.equal(await page.evaluate(() => window.starts), 0);
        await page.getByRole('button', { name: 'Belum, Kembali ke Jadwal' }).click();
        assert.equal(await page.evaluate(() => window.starts), 0);
        assert.equal(await page.evaluate(() => window.backs), 1);
        assert.equal(await page.evaluate(() => document.fullscreenElement), null);
        await mount();
        await page.getByRole('button', { name: 'Aktifkan Layar Penuh', exact: true }).click();
        await page.evaluate(() => window.exitTestFullscreen());
        await page.getByRole('heading', { name: 'Persiapan Ujian' }).waitFor();
        await page.getByRole('button', { name: 'Aktifkan Layar Penuh', exact: true }).click();
        await page.getByRole('button', { name: 'Ya, Mulai Ujian' }).dblclick();
        assert.equal(await page.evaluate(() => window.starts), 1);
        await mount('denied');
        await page.getByRole('button', { name: 'Aktifkan Layar Penuh', exact: true }).click();
        await page.getByRole('alert').waitFor();
        assert.equal(await page.getByRole('button', { name: 'Ya, Mulai Ujian' }).count(), 0);
        assert.equal(await page.evaluate(() => window.starts), 0);
        await page.setViewportSize({ width: 390, height: 844 });
        await mount('unsupported');
        await page.getByRole('button', { name: 'Aktifkan Layar Penuh', exact: true }).click();
        await page.getByText('Browser ini tidak mendukung layar penuh.', { exact: false }).waitFor();
        assert.equal(await page.evaluate(() => window.starts), 0);
        await page.getByRole('button', { name: 'Ya, Mulai Ujian' }).click();
        assert.equal(await page.evaluate(() => window.starts), 1);
        console.log('PASS: preparation, cancel exits fullscreen, fullscreen exit, single confirmation, rejection, and unsupported mobile browser');

        async function mountExamPage(hold) {
            await page.goto('about:blank');
            await page.evaluate(({ modules, hold }) => {
                let release;
                const pending = new Promise(resolve => { release = resolve; });
                window.releaseExamLoad = release;
                window.examStarts = 0;
                window.questionLoads = 0;
                window.detailLoads = 0;
                window.lockReleases = 0;
                const ReactCache = {};
                const exam = { id: 'test-exam', title: 'Ujian Matematika', duration_minutes: 60, metadata: { is_safe_mode: true } };
                const noop = () => {};
                const asyncNoop = async () => {};
                const screenshotHook = {
                    sharing: false, sharingRef: { current: false }, requesting: { current: false },
                    busy: false, error: '', supported: true, requestShare: asyncNoop,
                    capture: async () => null, upload: async () => true, stop: noop,
                };
                const toast = { success: noop, warning: noop, error: noop };
                const router = { push: noop };
                const params = { id: exam.id };
                const stubs = {
                    'next/navigation': { useParams: () => params, useRouter: () => router },
                    '@/app/components/ui/Toast': { useToast: () => toast },
                    '@/lib/session': { getSessionUser: async () => ({ id: 'student', email: 'student@example.invalid' }) },
                    '@/hooks/useExamScreenshots': { useExamScreenshots: () => screenshotHook },
                    '@/lib/device-id': { getDeviceId: () => 'test-device', setDeviceId: noop },
                    '@/lib/exam-editor-lock': { acquireExamEditorLock: async () => () => { window.lockReleases++; } },
                    '@/lib/exam-pwa': { isExamPwaEnabled: () => false, cacheExamOfflineShell: asyncNoop },
                    '@/lib/monitoring-health': { formatStudentName: value => value },
                    '@/lib/exam-network': { sampleExamNetwork: () => ({ weak: false }), examNetworkLabel: () => '' },
                    '@/lib/exam-retry': { examAutoRetryDelay: () => 1000 },
                    '@/lib/exam-question-updates': { mergeExamQuestionUpdates: (current) => current },
                    '@/lib/exam-wake-lock': { keepExamScreenAwake: () => noop },
                    '@/lib/exam-evidence-outbox': { retryExamEvidence: asyncNoop },
                    '@/lib/exam-screenshots': { screenshotBase64: async () => '' },
                    '@/lib/session-reset': { clearCbtSession: asyncNoop },
                    '@/lib/errors': { getErrorMessage: error => error.message },
                    '@/lib/api/client': { apiSend: async () => ({ success: true }) },
                    '@/lib/api/proctoring': { heartbeatExamAttempt: async () => ({ success: true }), logSecurityViolation: async () => ({ success: true }) },
                    '@/lib/exam-durable-storage': new Proxy({
                        inspectExamStorage: async () => ({ available: true, mode: 'indexeddb' }),
                        resolveDurableDeviceId: async id => id,
                        readExamSnapshot: async () => null,
                        readExamRecoverySession: async () => null,
                        readSecurityEvents: async () => [],
                        validateExamRecoverySession: () => ({ valid: false }),
                        ExamSnapshotConflictError: class extends Error {},
                    }, { get: (target, key) => target[key] || asyncNoop }),
                    '@/lib/api/students': {
                        getExamForAttempt: async () => {
                            window.detailLoads++;
                            if (window.detailLoads === 2 && hold === 'details') await pending;
                            return { success: true, exam, profile: null, hasStartedAttempt: false };
                        },
                        startExamAttemptAction: async () => {
                            window.examStarts++;
                            return { success: true, attempt: { id: 'attempt', status: 'in_progress', started_at: new Date().toISOString(), personal_end_time: new Date(Date.now() + 3600000).toISOString() }, answers: [], remainingSeconds: 3600 };
                        },
                        getExamQuestionsAction: async () => {
                            window.questionLoads++;
                            if (hold === 'questions') await pending;
                            return { success: true, questions: [{ id: 'q', type: 'essay', content: 'Soal Uji', bank_question_options: [] }] };
                        },
                    },
                };
                const require = name => {
                    if (name === 'lucide-react') return new Proxy({}, { get: () => () => null });
                    if (name === '@/app/components/ui/SkeletonPatterns') return { ExamPageSkeleton: () => require('react').createElement('p', {}, 'Memuat ujian') };
                    if (name === './ExamViewer') return { ExamViewer: props => require('react').createElement('div', {},
                        require('react').createElement('p', {}, props.isFullScreen ? 'Layar penuh aktif' : 'Layar penuh diperlukan'),
                        require('react').createElement('button', { onClick: props.onRequestFullscreen }, 'Aktifkan lagi'),
                        require('react').createElement('p', {}, 'Sisa waktu ' + props.timeLeft)) };
                    if (stubs[name]) return stubs[name];
                    if (!modules[name]) return {};
                    if (!ReactCache[name]) {
                        const module = { exports: {} }; ReactCache[name] = module;
                        new Function('module', 'exports', 'require', 'process', modules[name])(module, module.exports, require, { env: { NODE_ENV: 'development' } });
                    }
                    return ReactCache[name].exports;
                };
                let fullscreen = null;
                window.denyExamFullscreen = false;
                Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreen });
                Object.defineProperty(document.documentElement, 'requestFullscreen', { configurable: true, value: async () => {
                    if (window.denyExamFullscreen) throw new Error('denied');
                    fullscreen = document.documentElement; document.dispatchEvent(new Event('fullscreenchange'));
                } });
                window.exitTestFullscreen = () => { fullscreen = null; document.dispatchEvent(new Event('fullscreenchange')); };
                Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: async () => { window.exitTestFullscreen(); } });
                const root = document.createElement('div'); document.body.append(root);
                const reactRoot = require('react-dom/client').createRoot(root);
                window.unmountExamPage = () => reactRoot.unmount();
                reactRoot.render(require('react').createElement(require('ExamPage').default));
            }, { modules, hold });
            await page.getByRole('heading', { name: 'Persiapan Ujian' }).waitFor();
            await page.getByRole('button', { name: 'Aktifkan Layar Penuh', exact: true }).click();
            await page.getByRole('button', { name: 'Ya, Mulai Ujian' }).click();
        }

        await mountExamPage('details');
        await page.waitForFunction(() => window.detailLoads === 2);
        await page.evaluate(() => window.unmountExamPage());
        await page.evaluate(() => window.releaseExamLoad());
        await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 50)));
        assert.equal(await page.evaluate(() => window.examStarts), 0);
        assert.equal(await page.evaluate(() => window.lockReleases), 1);

        await mountExamPage('details');
        await page.waitForFunction(() => window.detailLoads === 2);
        await page.evaluate(() => { window.exitTestFullscreen(); window.releaseExamLoad(); });
        await page.getByRole('heading', { name: 'Persiapan Ujian' }).waitFor();
        assert.equal(await page.evaluate(() => window.examStarts), 0);
        await page.getByRole('button', { name: 'Aktifkan Layar Penuh', exact: true }).click();
        await page.getByRole('button', { name: 'Ya, Mulai Ujian' }).click();
        await page.getByText('Layar penuh aktif', { exact: true }).waitFor();
        assert.equal(await page.evaluate(() => window.examStarts), 1);

        await mountExamPage('questions');
        await page.waitForFunction(() => window.questionLoads === 1);
        await page.evaluate(() => { window.exitTestFullscreen(); window.releaseExamLoad(); });
        await page.getByText('Layar penuh diperlukan', { exact: true }).waitFor();
        assert.equal(await page.evaluate(() => window.examStarts), 1);
        await page.evaluate(() => { window.denyExamFullscreen = true; });
        await page.getByRole('button', { name: 'Aktifkan lagi' }).click();
        assert.equal(await page.getByText('Layar penuh diperlukan', { exact: true }).count(), 1);
        await page.evaluate(() => { window.denyExamFullscreen = false; });
        await page.getByRole('button', { name: 'Aktifkan lagi' }).click();
        await page.getByText('Layar penuh aktif', { exact: true }).waitFor();
        assert.equal(await page.evaluate(() => window.examStarts), 1);
        console.log('PASS: real ExamPage cancels start on unmount, requires reconfirmation after fullscreen exit before start, tracks exit while loading questions, and preserves a single attempt on reactivation');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
