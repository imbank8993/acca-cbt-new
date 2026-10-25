const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// Exercise the page's real loading and refresh callbacks without a network or database.
function harness() {
    const state = [], effects = [], timers = [], cleanups = [];
    let cursor = 0, initial = true, changes = 0, refresh, fetches = 0;
    let respond = async () => data();
    const React = {
        createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
        useState(value) {
            const index = cursor++;
            if (!(index in state)) state[index] = value;
            return [state[index], next => {
                const value = typeof next === 'function' ? next(state[index]) : next;
                if (!Object.is(value, state[index])) { changes++; state[index] = value; }
            }];
        },
        useRef(value) {
            const index = cursor++;
            if (!(index in state)) state[index] = { current: value };
            return state[index];
        },
        useCallback: fn => fn,
        useEffect(fn) { if (initial) effects.push(fn); },
    };
    const code = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../../web/app/dashboard/siswa/analytics/page.tsx'), 'utf8'), {
        compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const module = { exports: {} };
    const req = name => {
        if (name === 'react') return React;
        if (name === 'chart.js') return { Chart: { register() {} } };
        if (name === 'react-chartjs-2') return { Line: 'line-chart', Bar: 'bar-chart' };
        if (name === 'framer-motion') return { motion: new Proxy({}, { get: (_, key) => key }) };
        if (name === 'lucide-react') return new Proxy({}, { get: (_, key) => key });
        if (name.includes('useSchoolTimeZone')) return { useSchoolTimeZone: () => ({ timeZone: 'Asia/Makassar' }) };
        if (name.includes('school-time')) return { formatSchoolDate: date => date };
        if (name.includes('useAutoRefresh')) return { REFRESH_INTERVAL: { dashboard: 30000 }, useAutoRefresh: fn => { refresh = fn; } };
        if (name.includes('student-analytics')) return { getStudentAnalytics: () => { fetches++; return respond(); } };
        throw Error(`Unexpected import ${name}`);
    };
    new Function('require', 'module', 'exports', 'React', 'window', 'document', code)(req, module, module.exports, React,
        { setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout() {} },
        { fonts: { ready: new Promise(() => {}) } });
    const render = () => { cursor = 0; const tree = module.exports.default(); initial = false; return tree; };
    return {
        render,
        start: async () => {
            render();
            effects.forEach(fn => { const cleanup = fn(); if (cleanup) cleanups.push(cleanup); });
            timers.forEach(fn => fn());
            await new Promise(resolve => setImmediate(resolve));
        },
        refresh: () => refresh(),
        respond: fn => { respond = fn; },
        clearChanges: () => { changes = 0; },
        changes: () => changes,
        fetches: () => fetches,
        unmount: () => cleanups.forEach(fn => fn()),
    };
}
function data(score = 100) {
    return {
        overview: { averageScore: score, totalExams: 1, rank: null, percentile: null, totalStudyTime: 600 },
        performanceTrend: [{ date: '2026-10-25', score }], subjectPerformance: [], difficultyPerformance: [],
        strengthsWeaknesses: [], studyHabits: { averageTimePerExam: 600, fastestCompletion: 600, slowestCompletion: 600,
            averageQuestionsPerMinute: 0.5, speedMeasuredExams: 1, speedAnsweredQuestions: 5 },
        dataQuality: { excludedAttempts: 0, analyzedExams: 0, totalExams: 1, unknownGrades: 0, timedExams: 1 },
        examHistory: [], comparison: null,
    };
}
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.children)];

test('unchanged analytics and repeated focus checks preserve the current chart without loading', async () => {
    const h = harness(); await h.start();
    const chart = nodes(h.render()).find(node => node.type === 'line-chart');
    assert.ok(chart);
    assert.ok(chart.props.options.scales.y.max > 100);
    assert.equal(chart.props.options.scales.y.ticks.callback(100), '100%');
    h.clearChanges();
    await h.refresh(); await h.refresh();
    assert.equal(h.changes(), 0);
    h.respond(async () => data(75));
    await h.refresh();
    assert.equal(h.changes(), 1);
    assert.equal(nodes(h.render()).find(node => node.type === 'line-chart').props.data.datasets[0].data[0], 75);
    h.unmount();
});

test('background failure, overlapping requests and unmount never clear or replace existing data', async () => {
    const h = harness(); await h.start(); h.render(); h.clearChanges();
    h.respond(async () => { throw Error('offline'); });
    await h.refresh();
    assert.ok(nodes(h.render()).find(node => node.type === 'line-chart'));
    let resolve;
    h.respond(() => new Promise(done => { resolve = done; }));
    const count = h.fetches();
    const pending = h.refresh(); await h.refresh();
    assert.equal(h.fetches(), count + 1);
    h.unmount(); h.clearChanges();
    resolve(data(50)); await pending;
    assert.equal(h.changes(), 0);
});
