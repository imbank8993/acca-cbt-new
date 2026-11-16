// Check card layout and labels for data rows added after the first render.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { chromium } = require('playwright');

const modules = {};
for (const [name, pkg, file] of [
    ['react', 'react', 'react.development.js'],
    ['react-dom', 'react-dom', 'react-dom.development.js'],
    ['react-dom/client', 'react-dom', 'react-dom-client.development.js'],
    ['scheduler', 'scheduler', 'scheduler.development.js'],
]) modules[name] = fs.readFileSync(path.join(path.dirname(require.resolve(pkg)), 'cjs', file), 'utf8');
modules.labels = ts.transpileModule(fs.readFileSync('apps/web/app/components/mobile/MobileTableLabels.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;

(async () => {
    const executablePath = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe', chromium.executablePath()].find(fs.existsSync);
    const browser = await chromium.launch({ executablePath, headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 320, height: 640 } });
        await page.setContent(`<div class="dashboard-main" style="max-width:100%;padding:12px">
            <div id="hook"></div><div style="overflow-x:auto"><table class="mobile-data-cards" style="min-width:700px;width:100%">
            <thead><tr><th>Nama</th><th>Status</th><th>Aksi</th></tr></thead>
            <tbody><tr><td>Nama peserta yang sangat panjang tanpa dipotong</td><td>Menunggu keputusan</td><td><button>Lihat detail</button></td></tr></tbody>
            </table></div></div>`);
        await page.addStyleTag({ content: fs.readFileSync('apps/web/app/globals.css', 'utf8') });
        await page.evaluate(modules => {
            const cache = {};
            const require = name => {
                if (name === 'next/navigation') return { usePathname: () => '/test' };
                if (!cache[name]) {
                    const module = { exports: {} }; cache[name] = module;
                    new Function('module', 'exports', 'require', 'process', modules[name])(module, module.exports, require, { env: { NODE_ENV: 'development' } });
                }
                return cache[name].exports;
            };
            const React = require('react');
            require('react-dom/client').createRoot(document.getElementById('hook')).render(React.createElement(require('labels').MobileTableLabels));
        }, modules);
        await page.locator('td[data-mobile-label="Nama"]').waitFor();
        assert.equal(await page.locator('table').evaluate(node => getComputedStyle(node).display), 'block');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await page.evaluate(() => {
            const row = document.createElement('tr');
            row.innerHTML = '<td>Peserta kedua</td><td>Selesai</td><td><button>Rincian</button></td>';
            document.querySelector('tbody').append(row);
        });
        await page.locator('tbody tr:nth-child(2) td[data-mobile-label="Status"]').waitFor();
        await page.evaluate(() => {
            const modal = document.createElement('div');
            modal.innerHTML = '<table class="mobile-data-cards"><thead><tr><th>Item</th></tr></thead><tbody><tr><td>Isi modal</td></tr></tbody></table>';
            document.body.append(modal);
        });
        await page.locator('body > div:last-child td[data-mobile-label="Item"]').waitFor();
        const cardGap = await page.locator('tbody tr').evaluateAll(rows => rows[1].getBoundingClientRect().top - rows[0].getBoundingClientRect().bottom);
        assert.ok(cardGap > 0, 'Rows must be visually separate cards');
        await page.setViewportSize({ width: 768, height: 800 });
        assert.equal(await page.locator('.dashboard-main table').evaluate(node => getComputedStyle(node).display), 'block');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await page.setViewportSize({ width: 1280, height: 800 });
        assert.equal(await page.locator('.dashboard-main table').evaluate(node => getComputedStyle(node).display), 'table');
        console.log('PASS mobile data cards at 320px and 768px, dynamic labels, no horizontal page overflow, desktop table');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
