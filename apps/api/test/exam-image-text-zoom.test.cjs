const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });

const web = (file) => fs.readFileSync(path.resolve(__dirname, '../../web', file), 'utf8');
const scale = require('../../web/lib/exam-text-scale.ts');

test('question text size snaps to the allowed steps and stays within 90%-150%', () => {
    assert.deepEqual([...scale.EXAM_TEXT_SCALES], [0.9, 1, 1.15, 1.3, 1.5]);
    assert.equal(scale.normalizeExamTextScale('1.3'), 1.3);
    assert.equal(scale.normalizeExamTextScale(1.2), 1.15);
    assert.equal(scale.normalizeExamTextScale(9), 1.5);
    for (const junk of [null, undefined, '', 'abc', NaN]) assert.equal(scale.normalizeExamTextScale(junk), 1);
    assert.equal(scale.stepExamTextScale(1, 1), 1.15);
    assert.equal(scale.stepExamTextScale(1.5, 1), 1.5);
    assert.equal(scale.stepExamTextScale(0.9, -1), 0.9);
});

test('the chosen size is remembered on the device and survives blocked storage', () => {
    const store = new Map();
    global.window = { localStorage: {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, v),
        removeItem: (k) => store.delete(k),
    } };
    try {
        scale.storeExamTextScale(1.3);
        assert.equal(scale.readStoredExamTextScale(), 1.3);
        scale.storeExamTextScale(1);
        assert.equal(store.size, 0);
        global.window = { get localStorage() { throw new Error('blocked'); } };
        assert.equal(scale.readStoredExamTextScale(), 1);
        assert.doesNotThrow(() => scale.storeExamTextScale(1.5));
    } finally {
        delete global.window;
    }
});

test('exam card applies the size to question content only and makes images zoomable', () => {
    const card = web('app/components/questions/ExamQuestionCard.tsx');
    assert.match(card, /<ZoomableImages className=/);
    assert.match(card, /textScale !== 1 \? \{ zoom: textScale \}/);
    assert.equal(card.match(/data-exam-text-scale-target style=\{scaled\}/g).length, 3);
    const viewer = web('app/components/questions/ExamViewer.tsx');
    assert.equal(viewer.match(/<ExamTextScaleControl /g).length, 2, 'desktop and mobile headers');
    assert.match(viewer, /textScale=\{canScaleText \? textScale : 1\}/);
});

test('zoom viewer skips math and links, and option images keep click-to-select', () => {
    const zoom = web('app/components/questions/ZoomableImages.tsx');
    assert.match(zoom, /compact \? '\.latex-renderer img, \.question-content img' : 'img'/, 'result pages only mark question images');
    assert.match(zoom, /SKIP_SELECTOR = 'a, \.katex, \.mathjax-inline'/);
    assert.match(zoom, /math-equation-img/);
    assert.match(zoom, /\[data-cbt-option\]/);
    assert.match(zoom, /'data-zoomable-image', 'inline'/);
    assert.match(zoom, /scrollToZoom: true/);
    assert.match(zoom, /changeZoom\(1\)/);
    const results = web('app/components/questions/ResultImagePreview.tsx');
    assert.match(results, /<ZoomableImages compact/);
    assert.match(web('app/components/questions/result-image-preview.css'), /img\[data-zoomable-image="direct"\]/);
});
