const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function harness(imageHeight = 180, blockCount = 45) {
    const drawn = [], captures = [], removed = [];
    class Pdf {
        constructor(options) { this.options = options; this.pages = 1; this.page = 1; }
        setProperties(properties) { this.properties = properties; }
        addPage() { this.page = ++this.pages; }
        getNumberOfPages() { return this.pages; }
        setPage(page) { this.page = page; }
        splitTextToSize(text) { return [text]; }
        rect(x, y, w, h) { drawn.push({ type: 'rect', page: this.page, x, y, w, h }); }
        text(text, x, y, options = {}) { drawn.push({ type: 'text', page: this.page, text, x, y, options }); }
        addImage(...args) { drawn.push({ type: 'image', page: this.page, args }); }
        save(name) { this.saved = name; }
        setFillColor() {} setDrawColor() {} setTextColor() {} setFont() {} setFontSize() {} setLineWidth() {} line() {} roundedRect() {}
    }
    const canvas = () => ({ width: 1000, height: imageHeight, toDataURL: () => 'image', getContext: () => ({ drawImage() {} }) });
    const element = () => ({ style: {}, append() {}, setAttribute() {}, getBoundingClientRect: () => ({ top: 0 }),
        remove() { removed.push(this); }, querySelectorAll: selector => selector === 'p,li,tr,figure' && imageHeight > 1000
            ? Array.from({ length: blockCount }, (_, i) => ({ querySelector: () => null,
                getBoundingClientRect: () => ({ top: i * imageHeight / blockCount / 3, bottom: (i + 1) * imageHeight / blockCount / 3 - 1, height: imageHeight / blockCount / 3 - 1 }) }))
            : [], clientWidth: 1000, scrollWidth: 1000, scrollHeight: imageHeight });
    const document = {
        createElement: tag => tag === 'canvas' ? canvas() : element(),
        createTreeWalker: () => ({ nextNode: () => null }), fonts: { ready: Promise.resolve() }, body: { append() {} },
    };
    const source = fs.readFileSync(path.resolve(__dirname, '../../web/lib/export-irt-pdf.ts'), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    const mod = { exports: {} };
    new Function('require', 'module', 'exports', 'document', 'NodeFilter', code)(name => {
        if (name === 'jspdf') return { jsPDF: Pdf };
        if (name === 'dompurify') return { sanitize: text => text };
        if (name === 'html2canvas') return async (...args) => { captures.push(args); return canvas(); };
        if (name.endsWith('/irt-pdf-math')) return { renderIrtPdfMath: () => '<svg></svg>' };
        if (name.endsWith('/math-utils')) return { extractMathExpressions: () => [] };
        if (name.endsWith('/irt-calibration')) return { difficultyLabel: () => ({ label: 'Sedang' }) };
        if (name.endsWith('/school-time')) return { getSchoolTimeZone: async () => 'Asia/Makassar', getSchoolTimeZoneLabel: () => 'WITA' };
        throw Error(name);
    }, mod, mod.exports, document, { SHOW_TEXT: 4 });
    return { ...mod.exports, drawn, captures, removed };
}
const irt = models => ({ calculated_at: '2026-10-28T14:16:00Z', participant_count: 206, models, warnings: [],
    items: Array.from({ length: 40 }, (_, i) => ({ item_id: `q-${i}`, number: i + 1, text: 'Soal lengkap', part: null,
        p: .8, b: -1.234, a: .75, c: .25, correct: 165, total: 206, flags: i % 4 ? [] : ['Terlalu mudah'] })) });

test('IRT PDF uses portrait A4, repeats table headers and numbers every page, and exports every item', async () => {
    const h = harness();
    const pdf = await h.buildIrtParametersPdf(irt(['irt_1pl']), 'Matematika', 'Asia/Makassar');
    assert.deepEqual(pdf.options, { orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
    assert.ok(pdf.pages > 1);
    assert.equal(h.captures.length, 40);
    assert.equal(h.removed.length, 40, 'Offscreen question nodes are always cleaned up');
    for (let page = 1; page <= pdf.pages; page++) {
        assert.ok(h.drawn.some(call => call.page === page && Array.isArray(call.text) && call.text[0] === 'Kesulitan (b)'));
        assert.ok(h.drawn.some(call => call.page === page && call.text === `Halaman ${page} dari ${pdf.pages}`));
    }
    assert.ok(h.drawn.filter(call => call.type === 'rect').every(call => call.y + call.h <= 278.01));
    assert.equal(h.drawn.filter(call => call.type === 'image').length, 40);
    assert.ok(!h.drawn.some(call => Array.isArray(call.text) && call.text[0] === 'Daya beda (a)'));
    assert.ok(h.drawn.some(call => String(call.text).includes('22.16 WITA')));
});

test('3PL report retains all parameter columns and values; unusually long items continue on later pages', async () => {
    const h = harness(3000), data = irt(['irt_1pl', 'irt_2pl', 'irt_3pl']); data.items = data.items.slice(0, 1);
    const pdf = await h.buildIrtParametersPdf(data, 'Soal panjang');
    assert.ok(pdf.pages > 1);
    assert.ok(h.drawn.some(call => Array.isArray(call.text) && call.text[0] === 'Daya beda (a)'));
    assert.ok(h.drawn.some(call => Array.isArray(call.text) && call.text[0] === 'Tebakan (c)'));
    for (const value of ['80.0%', '-1.23', '0.75', '0.25', '165/206']) assert.ok(h.drawn.some(call => call.text === value), value);
    assert.ok(h.drawn.some(call => call.text === 'lanj.'));
    assert.ok(h.drawn.filter(call => call.type === 'image').every(call => call.args[3] + call.args[5] <= 278.01));
});

test('PDF filename is safe for a downloaded file and uses the exam title', () => {
    const h = harness();
    assert.equal(h.irtPdfFileName('ASAS / Matematika: XII?'), 'Analisis_IRT_ASAS_Matematika_XII.pdf');
    assert.equal(h.irtPdfFileName(''), 'Analisis_IRT_Ujian.pdf');
});

test('an indivisible oversized equation is fitted on the page rather than sliced into symbols', async () => {
    const h = harness(5000, 0), data = irt(['irt_1pl']); data.items = data.items.slice(0, 1);
    const pdf = await h.buildIrtParametersPdf(data, 'Persamaan panjang');
    assert.equal(pdf.pages, 1);
    const images = h.drawn.filter(call => call.type === 'image');
    assert.equal(images.length, 1);
    assert.ok(images[0].args[3] + images[0].args[5] <= 278.01);
});


test('PDF equations use self-contained SVG paths and readable inline fractions', () => {
    const loadTs = filename => {
        const source = fs.readFileSync(filename, 'utf8');
        const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
        const mod = { exports: {} };
        new Function('require', 'module', 'exports', code)(name => name.startsWith('./')
            ? loadTs(path.resolve(path.dirname(filename), name + '.ts')) : require(name), mod, mod.exports);
        return mod.exports;
    };
    const { renderIrtPdfMath } = loadTs(path.resolve(__dirname, '../../web/lib/irt-pdf-math.ts'));
    const equations = [String.raw`\frac{1}{3} \leq \frac{2x+5}{5} < \frac{4}{3}`,
        String.raw`\sqrt{x^2+\frac{1}{x+1}}`, String.raw`\int_0^1 x^2\,dx`,
        String.raw`\begin{pmatrix}1&2\\3&4\end{pmatrix}`];
    for (const latex of equations) {
        const svg = renderIrtPdfMath(latex, false);
        assert.match(svg, /^<svg\s/);
        assert.match(svg, /<path\s/);
        assert.match(svg, /vertical-align:/);
        assert.doesNotMatch(svg, /<use\s|data-mml-node="merror"|<foreignObject/);
    }
    const fraction = renderIrtPdfMath(String.raw`\frac{1}{3}`, false);
    const displayFraction = renderIrtPdfMath(String.raw`\dfrac{1}{3}`, false);
    assert.equal(fraction.match(/height="([^"]+)"/)[1], displayFraction.match(/height="([^"]+)"/)[1]);
});


test('short and multiline PDF rows center question, number, notes, and parameter groups vertically', async () => {
    for (const imageHeight of [90, 600]) {
        const h = harness(imageHeight), data = irt(['irt_1pl', 'irt_2pl', 'irt_3pl']);
        data.items = data.items.slice(0, 1);
        await h.buildIrtParametersPdf(data, 'Perataan vertikal', 'Asia/Makassar');
        const image = h.drawn.find(call => call.type === 'image');
        const row = h.drawn.filter(call => call.type === 'rect' && call.w === 182 && call.h >= 16).at(-1);
        const center = row.y + row.h / 2;
        assert.ok(Math.abs(image.args[3] + image.args[5] / 2 - center) < 0.001);
        const cell = text => h.drawn.find(call => call.type === 'text' && call.text === text && call.y >= row.y);
        for (const text of ['1', '0.75', '0.25']) {
            assert.equal(cell(text).y, center);
            assert.equal(cell(text).options.baseline, 'middle');
        }
        assert.ok(Math.abs((cell('80.0%').y + cell('165/206').y) / 2 - center) < 0.001);
        assert.ok(Math.abs((cell('-1.23').y + cell('Sedang').y) / 2 - center) < 0.001);
        const note = h.drawn.find(call => call.type === 'text' && Array.isArray(call.text) && call.text[0] === 'Terlalu mudah');
        assert.equal(note.y, center);
    }
});
