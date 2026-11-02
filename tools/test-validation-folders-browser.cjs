// Exercise the real management page, assignment form and teacher page against an in-memory API.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const ts = require('typescript');
const { chromium } = require('playwright');
const modules = {};
for (const [name, pkg, file] of [
    ['react', 'react', 'react.development.js'], ['react-dom', 'react-dom', 'react-dom.development.js'],
    ['react-dom/client', 'react-dom', 'react-dom-client.development.js'],
    ['react/jsx-runtime', 'react', 'react-jsx-runtime.development.js'], ['scheduler', 'scheduler', 'scheduler.development.js'],
]) modules[name] = fs.readFileSync(path.join(path.dirname(require.resolve(pkg)), 'cjs', file), 'utf8');
modules['lucide-react'] = fs.readFileSync(require.resolve('lucide-react'), 'utf8');
for (const [name, file] of Object.entries({
    Manager: 'apps/web/app/components/validations/ValidationsListPage.tsx',
    Teacher: 'apps/web/app/dashboard/guru/validations/page.tsx',
    './ValidationFolders': 'apps/web/app/components/validations/ValidationFolders.tsx',
    './AssignValidationModal': 'apps/web/app/components/validations/AssignValidationModal.tsx',
    '@/app/components/ui/modal': 'apps/web/app/components/ui/modal.tsx',
    '@/app/components/ui/button': 'apps/web/app/components/ui/button.tsx',
    '@/app/components/ui/inlineselect': 'apps/web/app/components/ui/inlineselect.tsx',
    '@/app/components/ui/filtertoolbar': 'apps/web/app/components/ui/filtertoolbar.tsx',
})) modules[name] = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
} }).outputText;

(async () => {
    const executablePath = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe', chromium.executablePath()].find(fs.existsSync);
    const browser = await chromium.launch({ executablePath, headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1360, height: 1000 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        const chunkDir = 'apps/web/.next/static/chunks';
        let css = '';
        if (fs.existsSync(chunkDir)) {
            const files = fs.readdirSync(chunkDir).filter(file => file.endsWith('.css')).map(file => path.join(chunkDir, file));
            files.sort((a, b) => fs.statSync(b).size - fs.statSync(a).size);
            if (files[0]) css = fs.readFileSync(files[0], 'utf8');
        }
        css += ['apps/web/app/components/validations/validation-folders.css', 'apps/web/app/components/validations/validations-mobile.css', 'apps/web/app/components/ui/modal.css', 'apps/web/app/components/ui/button.css', 'apps/web/app/components/ui/filter-toolbar.css']
            .map(file => fs.readFileSync(file, 'utf8')).join('\n');
        await page.setContent('<div id="root" style="max-width:1280px;margin:auto;padding:24px"></div>');
        await page.addStyleTag({ content: css });
        await page.evaluate(modules => {
            let React;
            const state = window.state = { folders: [], created: [], teacher: false,
                banks: [{ id: 'bank', title: 'Bank Matematika', subject: 'Matematika', created_by: 'owner' }],
                sessions: [{ id: 'existing', title: 'Validasi Matematika', bank_id: 'bank', status: 'pending', folder_id: null, created_at: '2026-11-02', approval_rule: 'unanimous', validators: [{ id: 'assignment', validator_id: 'teacher', status: 'assigned', profile: { full_name: 'Guru Validator' } }, { id: 'admin-assignment', validator_id: 'admin', status: 'assigned', profile: { full_name: 'Admin Validator' } }] }],
            };
            const api = {
                listValidations: async () => state.sessions.map(item => ({ ...item, bank: state.banks[0], folder: state.folders.find(folder => folder.id === item.folder_id) || null })),
                listValidationFolders: async () => state.folders.map(folder => ({ ...folder, canManage: true, canDelete: !state.sessions.some(item => item.folder_id === folder.id) })),
                listMyValidationTasks: async () => (await api.listValidations()).filter(item => item.validators.some(v => v.validator_id === 'teacher')).map(item => ({ id: item.id, status: 'assigned', validation: item })),
                createValidationFolder: async name => {
                    if (state.folders.some(folder => folder.name === name)) return { success: false, error: 'Nama folder validasi sudah digunakan.' };
                    const folder = { id: `folder-${state.folders.length + 1}`, name }; state.folders.push(folder); return { success: true, id: folder.id };
                },
                updateValidationFolder: async (id, name) => { Object.assign(state.folders.find(folder => folder.id === id), { name }); return { success: true, id }; },
                deleteValidationFolder: async id => { state.folders = state.folders.filter(folder => folder.id !== id); return { success: true }; },
                updateValidation: async (id, input) => { const item = state.sessions.find(item => item.id === id); if ('folderId' in input) item.folder_id = input.folderId; return { success: true }; },
                createValidation: async input => {
                    state.created.push(input);
                    state.sessions.push({ id: 'created', bank_id: input.bankId, title: input.title, folder_id: input.folderId, status: 'pending', created_at: '2026-11-02', approval_rule: input.approvalRule, validators: [{ id: 'new-assignment', validator_id: 'teacher', status: 'assigned', profile: { full_name: 'Guru Validator' } }] });
                    return { success: true, id: 'created' };
                },
            };
            const stubs = {
                'react-icons/ri': { RiArrowDropDownFill: ({ size = 16, ...props }) => React.createElement('svg', { ...props, width: size, height: size, viewBox: '0 0 24 24' }, React.createElement('path', { d: 'M7 10l5 5 5-5z', fill: 'currentColor' })) },
                '@/lib/api/validations': api,
                '@/lib/api/questions': { listQuestionBanks: async () => state.banks },
                '@/lib/api/pas': { listTeachersAndInvigilators: async () => [{ id: 'teacher', name: 'Guru Validator', roles: ['Guru'] }] },
                '@/lib/session': { getSessionUser: async () => ({ id: state.teacher ? 'teacher' : 'admin', resolved: { admin: !state.teacher } }) },
                '@/app/components/mobile/page-fab': { registerPageFab() {}, unregisterPageFab() {} },
                '@/hooks/useClientMounted': { useClientMounted: () => true },
                '@/lib/confirm-dialog': { confirmDialog: async () => true },
                '@/app/components/ui/DatePicker': { DatePicker: props => React.createElement('input', { type: 'date', value: props.value || '', onChange: event => props.onChange(event.target.value) }) },
                '@/app/components/ui/Spinner': { Spinner: () => null }, './Spinner': { Spinner: () => null },
                './ValidationReportModal': { ValidationReportModal: () => null },
                'next/link': { __esModule: true, default: props => React.createElement('a', props, props.children) },
            };
            const cache = {};
            const require = name => {
                if (name.endsWith('.css')) return {};
                if (name === '@/app/components/validations/ValidationFolders') name = './ValidationFolders';
                if (name === './button') name = '@/app/components/ui/button';
                if (name === '@/app/components/validations/ValidationsListPage') name = 'Manager';
                if (name === './modal') name = '@/app/components/ui/modal';
                if (stubs[name]) return stubs[name];
                if (!modules[name]) throw Error('Missing module: ' + name);
                if (!cache[name]) {
                    const module = { exports: {} }; cache[name] = module;
                    new Function('module', 'exports', 'require', 'process', modules[name])(module, module.exports, require, { env: { NODE_ENV: 'development' } });
                }
                return cache[name].exports;
            };
            React = require('react');
            const root = require('react-dom/client').createRoot(document.getElementById('root'));
            let mount = 0;
            window.mount = (name, manager = false) => { state.teacher = name === 'Teacher' && !manager; const component = require(name); root.render(React.createElement(component.default || component.ValidationsListPage, { key: ++mount, role: 'Admin' })); };
            window.mount('Manager');
        }, modules);
        await page.getByText('Validasi Matematika', { exact: true }).waitFor();
        await page.getByRole('button', { name: 'Buat Folder' }).click();
        await page.getByLabel('Nama folder', { exact: true }).fill('ASAS 2026');
        await page.getByRole('button', { name: 'Simpan Folder' }).click();
        const asas = page.getByRole('button', { name: 'Buka folder ASAS 2026', exact: true });
        await asas.waitFor();
        assert.equal(await asas.getAttribute('aria-expanded'), 'true');
        assert.equal(await page.getByRole('tab').count(), 0);
        assert.equal(await page.getByRole('button', { name: /^Semua Validasi|^Tanpa Folder/ }).count(), 0);
        // An unfiled session remains in the same list while folders are present.
        await page.getByText('Validasi Matematika', { exact: true }).waitFor();
        await page.getByRole('button', { name: 'Rincian' }).click();
        await page.getByLabel('Pindahkan sesi ke folder').selectOption('folder-1');
        await page.waitForFunction(() => window.state.sessions[0].folder_id === 'folder-1');
        await page.keyboard.press('Escape');
        await asas.click();
        assert.equal(await asas.getAttribute('aria-expanded'), 'false');
        assert.equal(await page.getByText('Validasi Matematika', { exact: true }).count(), 0);
        await asas.click();
        await page.getByText('Validasi Matematika', { exact: true }).waitFor();
        assert.equal(await page.getByRole('button', { name: 'Hapus folder ASAS 2026' }).isDisabled(), true);
        await page.getByRole('button', { name: 'Tambah validasi ke ASAS 2026', exact: true }).click();
        assert.equal(await page.getByLabel('Folder untuk validasi baru').inputValue(), 'folder-1');
        await page.getByPlaceholder('Cari dan pilih bank soal...').click();
        await page.getByText('Bank Matematika', { exact: true }).click();
        await page.getByText('Guru Validator', { exact: true }).last().click();
        await page.getByRole('button', { name: 'Simpan', exact: true }).click();
        await page.waitForFunction(() => window.state.created.length === 1);
        assert.equal(await page.evaluate(() => window.state.created[0].folderId), 'folder-1');
        await page.getByRole('dialog').waitFor({ state: 'detached' });
        await page.getByRole('button', { name: 'Rincian' }).first().click();
        await page.getByLabel('Pindahkan sesi ke folder').selectOption('');
        await page.waitForFunction(() => window.state.sessions[0].folder_id === null);
        await page.keyboard.press('Escape');
        // Filter personal tasks within the same screen, with no navigation tabs.
        await page.getByRole('combobox').first().selectOption('mine');
        await page.getByText('Validasi Matematika', { exact: true }).waitFor();
        assert.equal(await page.getByText('Validasi Soal: Bank Matematika', { exact: true }).count(), 0);
        await page.getByRole('combobox').first().selectOption('all');
        await page.getByRole('button', { name: 'Ubah folder ASAS 2026' }).click();
        await page.getByLabel('Nama folder', { exact: true }).fill('ASAS 2026/2027');
        await page.getByRole('button', { name: 'Simpan Folder' }).click();
        await page.getByRole('button', { name: 'Buka folder ASAS 2026/2027', exact: true }).waitFor();
        await page.waitForFunction(() => !Array.from(document.querySelectorAll('button')).find(button => button.textContent.includes('Buat Folder'))?.disabled);
        const output = process.env.VALIDATION_PREVIEW_DIR || path.join(os.tmpdir(), 'acca-validation-folders');
        fs.mkdirSync(output, { recursive: true });
        for (const theme of ['light', 'dark']) {
            await page.evaluate(theme => { document.documentElement.className = theme === 'dark' ? 'dark' : ''; document.body.style.background = theme === 'dark' ? '#080f1f' : '#f5f7fb'; }, theme);
            if (theme === 'dark') {
                await page.waitForFunction(() => getComputedStyle(document.querySelector('.validation-folder')).backgroundColor === 'rgb(14, 35, 69)');
                assert.equal(await page.locator('.validation-folder').first().evaluate(node => getComputedStyle(node).borderColor), 'rgb(46, 64, 90)');
            }
            await page.screenshot({ path: path.join(output, `validation-folders-${theme}.png`), fullPage: true });
        }
        await page.getByRole('combobox').first().selectOption('mine');
        await page.getByRole('button', { name: 'Buat Folder' }).click();
        await page.getByLabel('Nama folder', { exact: true }).fill('Folder Kosong');
        await page.getByRole('button', { name: 'Simpan Folder' }).click();
        assert.equal(await page.getByRole('combobox').first().inputValue(), 'all');
        await page.getByRole('button', { name: 'Hapus folder Folder Kosong', exact: true }).click();
        await page.getByRole('button', { name: 'Buka folder Folder Kosong', exact: true }).waitFor({ state: 'detached' });
        assert.equal(await page.evaluate(() => window.state.sessions.length), 2);
        await page.evaluate(() => window.mount('Teacher'));
        const teacherFolder = page.getByRole('button', { name: 'Buka folder ASAS 2026/2027', exact: true });
        await teacherFolder.waitFor();
        assert.equal(await page.getByRole('button', { name: 'Buat Folder' }).count(), 0);
        assert.equal(await page.getByRole('button', { name: /^Hapus folder/ }).count(), 0);
        assert.equal(await page.getByRole('tab').count(), 0);
        await page.getByText('Validasi Matematika', { exact: true }).waitFor();
        await teacherFolder.click();
        await page.getByText('Validasi Matematika', { exact: true }).waitFor();
        await page.setViewportSize({ width: 390, height: 844 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
        await page.screenshot({ path: path.join(output, 'validation-folders-mobile.png'), fullPage: true });
        await page.evaluate(() => window.mount('Teacher', true));
        await page.getByRole('button', { name: 'Buat Folder' }).waitFor();
        assert.equal(await page.getByRole('button', { name: 'Tambah Validasi', exact: true }).count(), 0);
        assert.equal(await page.getByRole('tab').count(), 0);
        assert.deepEqual(errors, []);
        console.log('PASS unified list without tabs, folder expand/collapse, unfiled sessions, personal-task filter, assignment, folder management, teacher/manager routes, light/dark and mobile');
        console.log('Previews:', output);
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
