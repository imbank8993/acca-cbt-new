// Browser regressions for the rich question renderer's HTML trust boundary.
// Loads the real React component and DOMPurify without starting an API server.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { chromium } = require('playwright');

(async () => {
    const executablePath = [
        'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
        'C:/Program Files/Google/Chrome/Application/chrome.exe',
        chromium.executablePath(),
    ].find(fs.existsSync);
    const browser = await chromium.launch({ executablePath, headless: true });
    try {
        const page = await browser.newPage();
        const pageErrors = [];
        page.on('pageerror', error => pageErrors.push(error.message));
        await page.route(/https:\/\/(www\.youtube(?:-nocookie)?\.com|player\.vimeo\.com)\//, route =>
            route.fulfill({ status: 200, contentType: 'text/html', body: '' }));
        await page.goto('about:blank');
        await page.addScriptTag({ path: path.join(path.dirname(require.resolve('dompurify')), 'purify.js') });

        const modules = {};
        for (const [name, pkg, file] of [
            ['react', 'react', 'react.development.js'],
            ['react-dom', 'react-dom', 'react-dom.development.js'],
            ['react-dom/client', 'react-dom', 'react-dom-client.development.js'],
            ['react/jsx-runtime', 'react', 'react-jsx-runtime.development.js'],
            ['scheduler', 'scheduler', 'scheduler.development.js'],
        ]) modules[name] = fs.readFileSync(path.join(path.dirname(require.resolve(pkg)), 'cjs', file), 'utf8');
        modules.LatexRenderer = ts.transpileModule(
            fs.readFileSync('apps/web/app/components/questions/LatexRenderer.tsx', 'utf8'),
            { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
                target: ts.ScriptTarget.ES2022, esModuleInterop: true } },
        ).outputText;

        await page.evaluate(modules => {
            const cache = {};
            const stubs = {
                dompurify: { __esModule: true, default: window.DOMPurify },
                './math-utils': { extractMathExpressions: () => [], renderLatex: () => ({ html: '', error: false }) },
                '@/lib/safe-url': { normalizeHtmlStorageUrls: html => html },
                '@/lib/arabic-utils': {
                    containsArabic: () => false,
                    segmentArabicAndLatin: () => [],
                    getFontFamilyForText: () => 'sans-serif',
                    getTextDirection: () => 'ltr',
                },
            };
            const require = name => {
                if (stubs[name]) return stubs[name];
                if (!modules[name]) throw new Error('Unexpected dependency: ' + name);
                if (!cache[name]) {
                    const module = { exports: {} };
                    cache[name] = module;
                    new Function('module', 'exports', 'require', 'process', modules[name])(
                        module, module.exports, require, { env: { NODE_ENV: 'development' } });
                }
                return cache[name].exports;
            };
            const React = require('react');
            const { createRoot } = require('react-dom/client');
            const { LatexRenderer } = require('LatexRenderer');
            const host = document.createElement('main');
            document.body.appendChild(host);
            const root = createRoot(host);
            window.richContentTest = {
                mount(text) { root.render(React.createElement(LatexRenderer, { text })); },
                forceSanitizerError(value) {
                    if (value) {
                        this.originalSanitize = window.DOMPurify.sanitize;
                        window.DOMPurify.sanitize = () => { throw new Error('injected sanitizer failure'); };
                    } else {
                        window.DOMPurify.sanitize = this.originalSanitize;
                    }
                },
            };
        }, modules);

        const mount = async (text, ready) => {
            await page.evaluate(text => window.richContentTest.mount(text), text);
            await page.waitForFunction(ready);
        };

        const malicious = '<strong>Soal</strong><img src=x onerror="window.__richXss=1"><script>window.__richXss=2</script>';
        await page.evaluate(() => window.richContentTest.forceSanitizerError(true));
        await mount(malicious, () => document.querySelector('.latex-renderer')?.textContent?.includes('<img src=x'));
        const fallback = await page.locator('.latex-renderer').evaluate(el => ({
            text: el.textContent,
            html: el.innerHTML,
            imageCount: el.querySelectorAll('img').length,
            scriptCount: el.querySelectorAll('script').length,
        }));
        assert.equal(fallback.text, malicious, 'sanitizer failure should preserve the whole question as plain text');
        assert.match(fallback.html, /&lt;img/);
        assert.equal(fallback.imageCount, 0);
        assert.equal(fallback.scriptCount, 0);
        assert.equal(await page.evaluate(() => window.__richXss), undefined);
        console.log('PASS sanitizer failure renders malicious HTML as inert text');

        await page.evaluate(() => window.richContentTest.forceSanitizerError(false));
        const frames = [
            '<iframe src="https://attacker.example/collect"></iframe>',
            '<iframe src="data:text/html,%3Cscript%3Eparent.__richXss=1%3C/script%3E"></iframe>',
            '<iframe src="https://www.youtube.com.evil.example/embed/dQw4w9WgXcQ"></iframe>',
            '<iframe src="https://www.youtube.com/watch?v=dQw4w9WgXcQ"></iframe>',
            '<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>',
            '<iframe src="https://player.vimeo.com/video/123456"></iframe>',
        ].join('');
        await mount('<p>Video pembelajaran</p>' + frames, () =>
            document.querySelector('.latex-renderer')?.textContent?.includes('Video pembelajaran'));
        await page.waitForFunction(() => document.querySelectorAll('.latex-renderer iframe').length === 2);
        const result = await page.locator('.latex-renderer').evaluate(el => ({
            sources: [...el.querySelectorAll('iframe')].map(frame => frame.getAttribute('src')),
            text: el.textContent,
        }));
        assert.deepEqual(result.sources, [
            'https://www.youtube.com/embed/dQw4w9WgXcQ',
            'https://player.vimeo.com/video/123456',
        ]);
        assert.match(result.text, /Video pembelajaran/);
        assert.equal(await page.evaluate(() => window.__richXss), undefined);
        assert.deepEqual(pageErrors, [], 'renderer should not cause uncaught browser errors');
        console.log('PASS arbitrary and data iframes removed; YouTube and Vimeo embeds retained');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
