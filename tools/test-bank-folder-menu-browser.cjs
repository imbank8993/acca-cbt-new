// Run the real menu JSX and shared hook in an isolated browser, without accounts or API writes.
const fs = require('node:fs');
const path = require('node:path');
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
const compile = source => ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
} }).outputText;
modules.hook = compile(fs.readFileSync('apps/web/lib/useBankFolderMenu.ts', 'utf8'));
for (const role of ['admin', 'guru', 'proktor']) {
    const file = `apps/web/app/dashboard/${role}/questions/page.tsx`;
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let menu;
    const visit = node => {
        if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some(attr =>
            ts.isJsxAttribute(attr) && attr.name.getText(source) === 'ref' && attr.initializer?.getText(source).includes('folderMenuRef'))) menu = node.getText(source);
        ts.forEachChild(node, visit);
    };
    visit(source);
    assert.ok(menu, `${role} must attach the dismissal ref to the menu and trigger`);
    modules[role] = compile(`
        import React from 'react';
        import { MoreHorizontal, Plus, BookOpen, Check, Edit3, Trash2 } from 'lucide-react';
        import { useBankFolderMenu } from 'hook';
        export default function Harness() {
            const { folderMenuId, setFolderMenuId, folderMenuRef } = useBankFolderMenu();
            const isSubmitting = false;
            const noop = () => {};
            const setEditingBank = noop, setTargetFolderId = noop, setIsAddModalOpen = () => window.created++;
            const setBulkMode = noop, setSelectedBankIds = noop, setExpandedFolders = noop;
            const handleOpenAddToFolder = () => { window.existing++; setFolderMenuId(null); };
            const handleOpenEditFolder = () => { window.edited++; setFolderMenuId(null); };
            const handleDeleteFolder = () => { window.deleted++; setFolderMenuId(null); };
            return <><button id="outside">Di luar menu</button>{[
                { id: 'filled', name: 'Berisi soal', canManage: true, canDelete: false },
                { id: 'empty', name: 'Kosong', canManage: true, canDelete: true },
            ].map(folder => { const folderBanks = folder.canDelete ? [] : [{ id: 'bank' }];
                return <section key={folder.id} data-folder={folder.id}>${menu}</section>;
            })}</>;
        }
    `);
}

(async () => {
    const executablePath = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe', chromium.executablePath()].find(fs.existsSync);
    const browser = await chromium.launch({ executablePath, headless: true });
    try {
        const page = await browser.newPage({ hasTouch: true });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        for (const role of ['admin', 'guru', 'proktor']) {
            await page.setContent('<style>section{display:inline-block;vertical-align:top;width:280px;height:360px}.relative{position:relative}.bank-folder-menu{position:absolute;background:white;z-index:1;width:250px}.bank-folder-menu button{display:block;margin:8px}</style><div id="root"></div>');
            await page.evaluate(({ modules, role }) => {
                const cache = {};
                const require = name => {
                    if (!cache[name]) {
                        const module = { exports: {} }; cache[name] = module;
                        new Function('module', 'exports', 'require', 'process', modules[name])(module, module.exports, require, { env: { NODE_ENV: 'development' } });
                    }
                    return cache[name].exports;
                };
                window.created = window.existing = window.edited = window.deleted = 0;
                require('react-dom/client').createRoot(document.getElementById('root')).render(require('react').createElement(require(role).default));
            }, { modules, role });
            const filled = page.getByRole('button', { name: 'Menu folder Berisi soal' });
            const empty = page.getByRole('button', { name: 'Menu folder Kosong' });
            const menu = page.locator('.bank-folder-menu');
            await filled.click();
            await menu.waitFor();
            assert.equal(await menu.getByRole('button', { name: 'Hapus Folder' }).isDisabled(), true);
            assert.match(await menu.getByRole('button', { name: 'Hapus Folder' }).getAttribute('title'), /Pindahkan semua bank soal/);
            await menu.locator('.bank-folder-menu__heading').click();
            assert.equal(await menu.count(), 1, 'clicking within the menu must leave it open');
            // Outside handlers that stop bubbling cannot prevent dismissal.
            await page.locator('#outside').evaluate(button => button.addEventListener('pointerdown', event => event.stopPropagation()));
            await page.locator('#outside').click();
            await menu.waitFor({ state: 'detached' });
            await filled.click();
            await empty.click();
            assert.equal(await menu.count(), 1);
            assert.equal(await empty.getAttribute('aria-expanded'), 'true');
            await page.keyboard.press('Escape');
            await menu.waitFor({ state: 'detached' });
            assert.equal(await empty.evaluate(button => button === document.activeElement), true);
            await empty.click();
            await empty.click();
            await menu.waitFor({ state: 'detached' });
            await empty.click();
            await menu.getByRole('button', { name: 'Buat Baru' }).click();
            await menu.waitFor({ state: 'detached' });
            assert.equal(await page.evaluate(() => window.created), 1);
            await empty.click();
            await menu.getByRole('button', { name: 'Hapus Folder' }).click();
            assert.equal(await page.evaluate(() => window.deleted), 1);
            await menu.waitFor({ state: 'detached' });
            await empty.tap();
            await page.locator('#outside').tap();
            await menu.waitFor({ state: 'detached' });
            await empty.click();
            await page.locator('#outside').focus();
            await menu.waitFor({ state: 'detached' });
            console.log(`PASS ${role}: outside click/tap, Escape, focus, switch/toggle, actions, and nonempty deletion disabled`);
        }
        assert.deepEqual(errors, []);
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
