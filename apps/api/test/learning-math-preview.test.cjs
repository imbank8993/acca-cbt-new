const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const jsdom = require('jsdom');
const katex = require('katex');

test('LMS preview renders KaTeX/LaTeX delimiters in HTML documents and dynamic quizzes', async () => {
    const window = jsdom.JSDOM ? new jsdom.JSDOM('').window : jsdom.jsdom('').defaultView;
    window.Element.prototype.prepend ||= function(node) { this.insertBefore(node, this.firstChild); };
    window.Element.prototype.after ||= function(node) { this.parentNode.insertBefore(node, this.nextSibling); };
    window.Element.prototype.append ||= function(node) { this.appendChild(node); };
    window.Element.prototype.closest ||= function(selector) {
        for (let element = this; element; element = element.parentElement) if (element.matches(selector)) return element;
        return null;
    };

    const purify = require('dompurify')(window);
    const exports = {};
    const source = fs.readFileSync(path.resolve(__dirname, '../../web/lib/learning-preview.ts'), 'utf8');

    // Provide DOMPurify and real KaTeX in the test sandbox
    vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } }).outputText, {
        exports,
        require: (mod) => {
            if (mod === 'katex') return katex;
            return purify;
        },
        DOMParser: window.DOMParser,
        URL,
        location: { protocol: 'https:', origin: 'https://school.example' },
        crypto: require('node:crypto').webcrypto,
    });

    const testHtml = `
        <article>
            <h1>Bab 1: Fisika Dasar</h1>
            <p>Energi relativistik dinyatakan dengan rumus $E = mc^2$ menurut Einstein.</p>
            <p>Persamaan kuadrat:</p>
            $$x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$$
            <p>Delimiter alternatif: \\(a^2 + b^2 = c^2\\) dan display \\[\\sum_{i=1}^n i = \\frac{n(n+1)}{2}\\]</p>
            <p id="barisan">Barisan <span>$</span><strong>U_n=a+(n-1)b</strong><span>$</span> dan $S_n=\\frac{n}{2}(a+U_n)$.</p>
            <p id="deret">Deret <span>$$</span><em>S_n=\\sum_{i=1}^n U_i</em><span>$$</span></p>
            <p id="barisan-baris"><span>$</span>
                <strong>U_n=a+(n-1)b</strong>
                <span>$</span></p>
            <p id="tak-lengkap">$rumus belum lengkap</p><p id="paragraf-lain">teks biasa$</p>
            <code>const x = "$not_math$";</code>
            <pre>for $i=0; $i<10</pre>
        </article>
    `;

    // 1. Test interactive mode (HTML file upload default)
    const interactiveResult = exports.learningPreviewDocument(testHtml, true);
    const docInteractive = new window.DOMParser().parseFromString(interactiveResult, 'text/html');
    assert.equal(docInteractive.querySelector('script[src]').getAttribute('src'), 'https://school.example/learning/katex.min.js');

    // Ensure MathML elements are created
    const mathElements = docInteractive.querySelectorAll('math');
    assert.equal(mathElements.length, 8, 'Harus merender rumus utuh meski delimiter terpisah oleh format HTML');
    assert.equal(docInteractive.querySelectorAll('#barisan math').length, 2);
    assert.equal(docInteractive.querySelectorAll('#deret math').length, 1);
    assert.equal(docInteractive.querySelectorAll('#barisan-baris math').length, 1);
    assert.equal(docInteractive.querySelector('#barisan').textContent.includes('$'), false);
    assert.equal(docInteractive.querySelector('#tak-lengkap').textContent, '$rumus belum lengkap');
    assert.equal(docInteractive.querySelector('#paragraf-lain').textContent, 'teks biasa$');

    // Check display block vs inline
    const blockMath = docInteractive.querySelectorAll('math[display="block"]');
    assert.equal(blockMath.length, 3, 'Harus ada 3 block/display math termasuk $$ yang terbagi antar span');

    // Ensure code and pre contents are untouched
    const codeEl = docInteractive.querySelector('code');
    assert.equal(codeEl.textContent, 'const x = "$not_math$";');

    const preEl = docInteractive.querySelector('pre');
    assert.equal(preEl.textContent, 'for $i=0; $i<10');

    // The activity creates question and option nodes after the preview is parsed.
    // The trusted runtime must render them without replacing their parent controls.
    let notifyMutation;
    class TestObserver { constructor(callback) { notifyMutation = callback; } observe() {} }
    window.katex = katex;
    const runtime = [...docInteractive.querySelectorAll('script')].find(script => script.textContent.includes('const regex ='));
    assert.ok(runtime, 'Renderer dinamis harus disisipkan pada HTML interaktif');
    new Function('window', 'document', 'NodeFilter', 'MutationObserver', 'setTimeout', runtime.textContent)(
        window, docInteractive, window.NodeFilter, TestObserver, setTimeout,
    );
    const question = docInteractive.createElement('p');
    question.textContent = String.raw`Deret $(3x-1)+(3x-1)^2+\dots$ konvergen jika $x$ berada pada interval...`;
    const option = docInteractive.createElement('button');
    option.textContent = String.raw`$0 < x < \frac{2}{3}$`;
    let clicked = false;
    option.addEventListener('click', () => { clicked = true; });
    docInteractive.body.appendChild(question);
    docInteractive.body.appendChild(option);
    notifyMutation();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(question.querySelectorAll('math').length, 2);
    assert.equal(option.querySelectorAll('math').length, 1);
    assert.equal(option.querySelectorAll('mfrac').length, 1);
    assert.equal(option.textContent.includes('$'), false);
    option.click();
    assert.equal(clicked, true, 'Tombol kuis tetap dapat digunakan sesudah rumus dirender');
    option.textContent = String.raw`$-\frac{2}{3} < x < 0$`;
    notifyMutation();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(option.querySelectorAll('math').length, 1, 'Pergantian soal ikut diproses');
    assert.equal(option.querySelectorAll('mfrac').length, 1);
    option.click();
    assert.equal(clicked, true);

    // 2. Test non-interactive mode (DOMPurify path)
    const sanitizedResult = exports.learningPreviewDocument(testHtml, false);
    const docSanitized = new window.DOMParser().parseFromString(sanitizedResult, 'text/html');
    const sanitizedMath = docSanitized.querySelectorAll('math');
    assert.equal(sanitizedMath.length, 8, 'Mode non-interactive juga harus merender rumus lintas elemen');

    window.close();
});
