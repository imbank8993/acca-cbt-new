// Exercise the actual catalogue and create form without a live API or user account.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const ts = require('typescript');
const { chromium } = require('playwright');

(async () => {
    const modules = {};
    modules['lucide-react'] = fs.readFileSync(require.resolve('lucide-react'), 'utf8');
    for (const [name, pkg, file] of [
        ['react', 'react', 'react.development.js'], ['react-dom', 'react-dom', 'react-dom.development.js'],
        ['react-dom/client', 'react-dom', 'react-dom-client.development.js'],
        ['react/jsx-runtime', 'react', 'react-jsx-runtime.development.js'], ['scheduler', 'scheduler', 'scheduler.development.js'],
    ]) modules[name] = fs.readFileSync(path.join(path.dirname(require.resolve(pkg)), 'cjs', file), 'utf8');
    for (const [name, file] of Object.entries({
        Library: 'apps/web/app/dashboard/learning/page.tsx',
        Editor: 'apps/web/app/dashboard/learning/[id]/edit/page.tsx',
        '@/lib/learning-catalog': 'apps/web/lib/learning-catalog.ts',
        '@/app/components/learning/CreateSubchapterModal': 'apps/web/app/components/learning/CreateSubchapterModal.tsx',
        '@/app/components/ui/modal': 'apps/web/app/components/ui/modal.tsx',
        '@/app/components/ui/button': 'apps/web/app/components/ui/button.tsx',
    })) modules[name] = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
        module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
    } }).outputText;
    const output = process.env.LEARNING_PREVIEW_DIR || path.join(os.tmpdir(), 'acca-learning-catalog');
    fs.mkdirSync(output, { recursive: true });
    const executablePath = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe', chromium.executablePath()].find(fs.existsSync);
    const browser = await chromium.launch({ executablePath, headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('http://catalog.test/**', route => route.fulfill({ contentType: 'text/html', body: '<html></html>' }));
        await page.goto('http://catalog.test', { waitUntil: 'commit' });
        await page.setContent('<html><head></head><body><div id="root"></div></body></html>');
        // A secure local origin is unnecessary for a mocked API; provide stable fixture IDs.
        await page.evaluate(() => { if (!crypto.randomUUID) Object.defineProperty(crypto, 'randomUUID', { value: () => '00000000-0000-4000-8000-000000000123' }); });
        const built = path.join('apps/web/.next/static/chunks');
        const cssFiles = fs.existsSync(built) ? fs.readdirSync(built).filter(file => file.endsWith('.css')).map(file => path.join(built, file)) : [];
        const utilities = cssFiles.sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0];
        if (utilities) await page.addStyleTag({ path: utilities });
        await page.addStyleTag({ content: fs.readFileSync('apps/web/app/globals.css', 'utf8').replace(/^@import.*$/gm, '').replace(/^@custom-variant.*$/gm, '') });
        for (const file of ['apps/web/app/components/ui/modal.css', 'apps/web/app/components/ui/button.css', 'apps/web/app/components/learning/learning.css']) await page.addStyleTag({ path: file });
        await page.addStyleTag({ content: ':root{--font-sans:Arial,sans-serif;--font-open-sans:Arial,sans-serif;--font-poppins:Arial,sans-serif}body{padding:32px;font-family:Arial,sans-serif} @media(max-width:760px){body{padding:16px}}' });
        await page.evaluate(modules => {
            const cache = {};
            let React;
            const base = { title: 'Definisi fungsi', grade_level: '10', subject: 'Matematika', topic: 'Fungsi', subtopic: 'Definisi fungsi', subtopic_order: 1,
                status: 'published', format: 'html', description: '', updated_at: '2026-11-02T00:00:00Z' };
            const state = window.catalogFixture = { manager: true, route: '', created: null, materials: [
                { ...base, id: 'first', completed: true }, { ...base, id: 'second', subtopic: 'Daerah asal', title: 'Daerah asal', subtopic_order: 2 },
                { ...base, id: 'grade11', grade_level: '11' }, { ...base, id: 'general', grade_level: '', subject: 'Literasi', topic: 'Membaca efektif' },
                { ...base, id: 'draft', status: 'draft', subtopic: 'Draf rahasia', subtopic_order: 3 },
            ] };
            const api = async (url = '', init = {}) => {
                if (url === '/first/file') {
                    state.uploaded = Object.fromEntries([...init.body.entries()].filter(([key]) => key !== 'file'));
                    return { material: { ...state.materials[0], title: state.uploaded.title, subtopic: state.uploaded.subtopic, topic: state.uploaded.topic, grade_level: state.uploaded.gradeLevel, subtopic_order: Number(state.uploaded.subtopicOrder), revision: 2, hasFile: true, content_html: state.uploaded.contentHtml } };
                }
                if (url === '/first') return { canEdit: true, material: { ...state.materials[0], revision: 1, hasFile: false, content_html: '', conversion_notes: '' } };
                if (init.method === 'POST') { const dto = JSON.parse(init.body); state.created = dto; return { material: { id: dto.id } }; }
                return { canManage: state.manager, materials: state.materials.filter(item => state.manager && url.includes('manage=1') || item.status === 'published') };
            };
            const stubs = {
                'next/link': { __esModule: true, default: props => React.createElement('a', props, props.children) },
                'next/navigation': { useParams: () => ({ id: 'first' }), useRouter: () => ({ push: route => { state.route = route; } }) },
                '@/lib/learning-api': { learningRequest: api, deleteMaterial: async () => ({ success: true }), saveMaterial: async material => { state.saved = material; return { material }; } },
                '@/lib/confirm-dialog': { confirmDialog: async () => true, deleteConfirmDialog: async () => true },
                '@/lib/session': { fetchSessionUser: async () => ({ id: 'teacher' }) },
                '@/lib/learning-converter': { convertLearningFile: async () => ({ format: 'html', html: '<h1>Daerah asal</h1>', notes: [] }) },
                '@/lib/learning-templates': { downloadLearningTemplate: async () => {} },
                '@/lib/learning-preview': { learningPreviewDocument: html => html },
                '@/app/components/learning/MaterialPreview': { MaterialPreview: () => React.createElement('div', null, 'Pratinjau subbab') },
                '@/app/components/learning/ActivityResults': { ActivityResults: () => null },
                '@/hooks/useClientMounted': { useClientMounted: () => true },
                './button': null,
                './Spinner': { Spinner: () => null },
            };
            const require = name => {
                if (name.endsWith('.css')) return {};
                if (name === './button') name = '@/app/components/ui/button';
                if (stubs[name]) return stubs[name];
                if (!modules[name]) throw new Error('Unexpected module: ' + name);
                if (!cache[name]) {
                    const module = { exports: {} }; cache[name] = module;
                    new Function('module', 'exports', 'require', 'process', modules[name])(module, module.exports, require, { env: { NODE_ENV: 'development' } });
                }
                return cache[name].exports;
            };
            React = require('react');
            const root = require('react-dom/client').createRoot(document.getElementById('root'));
            let mount = 0;
            window.mountCatalogue = () => root.render(React.createElement(require('Library').default, { key: ++mount }));
            window.mountEditor = () => root.render(React.createElement(require('Editor').default));
            window.mountCatalogue();
        }, modules);
        await page.getByRole('heading', { name: 'Fungsi', exact: true }).first().waitFor();
        assert.equal(await page.locator('.learn-chapter-card').count(), 3);
        await page.getByRole('button', { name: /^Kelas X\s/ }).click();
        assert.equal(await page.locator('.learn-chapter-card').count(), 1);
        await page.getByRole('button', { name: 'Fungsi', exact: true }).click();
        assert.deepEqual(await page.locator('.learn-subchapter-link strong').allTextContents(), ['Definisi fungsi', 'Daerah asal']);
        assert.equal(await page.getByRole('link', { name: /Daerah asal/ }).getAttribute('href'), '/dashboard/learning/second');
        await page.screenshot({ path: path.join(output, 'learning-chapters-light.png'), fullPage: true });
        await page.evaluate(() => document.documentElement.classList.add('dark'));
        await page.waitForFunction(() => getComputedStyle(document.querySelector('.learn-grade-tabs button:not([aria-pressed=true])')).backgroundColor === 'rgb(18, 28, 46)');
        const inactive = await page.getByRole('button', { name: /^Kelas XI\s/ }).evaluate(el => {
            const style = getComputedStyle(el);
            return { background: style.backgroundColor, color: style.color, opacity: style.opacity };
        });
        console.log('Inactive grade theme: ' + JSON.stringify(inactive));
        assert.equal(inactive.background, 'rgb(18, 28, 46)');
        await page.screenshot({ path: path.join(output, 'learning-chapters-dark.png'), fullPage: true });
        await page.setViewportSize({ width: 390, height: 844 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await page.screenshot({ path: path.join(output, 'learning-chapters-mobile.png'), fullPage: true });
        await page.setViewportSize({ width: 1280, height: 1000 });
        await page.getByRole('button', { name: 'Kelola materi' }).click();
        await page.getByRole('button', { name: 'Tambah subbab', exact: true }).waitFor();
        await page.getByRole('button', { name: /^Kelas X\s/ }).click();
        await page.getByRole('button', { name: 'Subbab', exact: true }).click();
        assert.equal(await page.getByLabel('BAB', { exact: true }).inputValue(), 'Fungsi');
        assert.equal(await page.getByLabel('Urutan', { exact: true }).inputValue(), '4');
        await page.getByLabel('Judul subbab').fill('Komposisi fungsi');
        await page.screenshot({ path: path.join(output, 'learning-add-subchapter.png'), fullPage: true });
        await page.getByRole('button', { name: 'Lanjut unggah file' }).click();
        await page.waitForFunction(() => window.catalogFixture.created);
        const dto = await page.evaluate(() => window.catalogFixture.created);
        assert.equal(dto.gradeLevel, '10'); assert.equal(dto.topic, 'Fungsi'); assert.equal(dto.subtopicOrder, 4);
        assert.equal(dto.subtopic, 'Komposisi fungsi');
        await page.evaluate(() => { window.catalogFixture.manager = false; window.mountCatalogue(); });
        await page.getByRole('heading', { name: 'Fungsi', exact: true }).first().waitFor();
        assert.equal(await page.getByRole('button', { name: 'Kelola materi' }).count(), 0);
        assert.equal(await page.getByText('Draf rahasia').count(), 0);
        await page.evaluate(() => { window.catalogFixture.manager = true; window.mountEditor(); });
        await page.getByLabel('Judul subbab', { exact: true }).waitFor();
        assert.equal(await page.getByLabel('Tingkatan kelas').inputValue(), '10');
        assert.equal(await page.getByLabel('BAB', { exact: true }).inputValue(), 'Fungsi');
        await page.getByLabel('Judul subbab', { exact: true }).fill('Daerah asal diperbarui');
        await page.getByLabel('Urutan subbab').fill('2');
        await page.getByLabel('Unggah bahan ajar').setInputFiles({ name: 'daerah-asal.html', mimeType: 'text/html', buffer: Buffer.from('<h1>Daerah asal</h1>') });
        await page.waitForFunction(() => window.catalogFixture.uploaded);
        const upload = await page.evaluate(() => window.catalogFixture.uploaded);
        assert.equal(upload.topic, 'Fungsi'); assert.equal(upload.gradeLevel, '10'); assert.equal(upload.subtopicOrder, '2');
        assert.equal(upload.subtopic, 'Daerah asal diperbarui');
        await page.getByRole('button', { name: 'Simpan draf' }).click();
        await page.waitForFunction(() => window.catalogFixture.saved);
        assert.equal(await page.evaluate(() => window.catalogFixture.saved.subtopic_order), 2);
        assert.deepEqual(errors, []);
        console.log('PASS: grouping, grade isolation, ordered subchapters, reader links, create context, student permissions, editor upload/save classification, dark/light and mobile layouts.');
        console.log('Previews: ' + output);
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
