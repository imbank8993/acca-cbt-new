const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// KaTeX menyusun rumus dari font per bagian (KaTeX_Size1–4 untuk kurung besar, ∫ dan Σ)
// dan SVG ber-posisi absolut untuk sambungan kurung. CSS global yang menimpa font,
// display SVG, warna, atau jarak di dalam .katex membuat kurung cases terpotong,
// kurung matriks/integral mengecil, dan operator renggang.
const css = fs.readFileSync(path.resolve(__dirname, '../../web/app/globals.css'), 'utf8').replace(/\r\n/g, '\n');
// Pisah selektor hanya di koma tingkat atas (bukan di dalam :where()/:not()).
function splitSelectors(text) {
    const parts = []; let depth = 0, start = 0;
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '(') depth++;
        else if (text[i] === ')') depth--;
        else if (text[i] === ',' && depth === 0) { parts.push(text.slice(start, i)); start = i + 1; }
    }
    parts.push(text.slice(start));
    return parts.map(s => s.trim()).filter(Boolean);
}
const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map(([, selector, body]) => ({ selectors: splitSelectors(selector), body }));

test('no global rule forces a font on elements inside .katex', () => {
    for (const { selectors, body } of rules) {
        if (!/font-family/.test(body)) continue;
        for (const selector of selectors) {
            const target = selector.replace(/:(where|not)\((?:[^()]|\([^()]*\))*\)/g, '');
            assert.doesNotMatch(target, /\.katex\s+\*|\.katex\s+span|\.math-node\s+\*|mjx-container\s+\*/, `font paksa di dalam rumus: ${selector}`);
        }
    }
});

test('KaTeX SVG, colour and operator spacing are left to KaTeX', () => {
    for (const { selectors, body } of rules) {
        const inside = selectors.filter(s => /\.katex\s+\S/.test(s));
        if (!inside.length) continue;
        assert.doesNotMatch(body, /(stroke|fill|color)\s*:[^;]*!important/, `warna/stroke !important di dalam rumus: ${inside.join(', ')}`);
        if (inside.some(s => /\.(mbin|mrel|mopen|mclose)\b/.test(s))) {
            assert.doesNotMatch(body, /\b(margin|padding)/, `jarak tambahan pada operator: ${inside.join(', ')}`);
        }
    }
});

test('global SVG display overrides exclude KaTeX SVGs', () => {
    for (const { selectors, body } of rules) {
        if (!/display\s*:\s*inline\s*!important/.test(body)) continue;
        for (const selector of selectors.filter(s => /^svg\[style/.test(s))) {
            assert.match(selector, /:not\(\.katex svg\)/, `SVG KaTeX ikut terkena: ${selector}`);
        }
    }
});

test('generic font inherit rules inside question content skip KaTeX', () => {
    const rule = rules.find(({ selectors, body }) => /font-family:\s*inherit/.test(body) && selectors.some(s => s.startsWith('.latex-renderer *')));
    assert.ok(rule, 'aturan inherit .latex-renderer * ada');
    for (const selector of rule.selectors.filter(s => /\s(span|p|div|li|\*)/.test(s))) {
        assert.match(selector, /:where\(:not\(\.katex, \.katex \*\)\)/, selector);
    }
});
