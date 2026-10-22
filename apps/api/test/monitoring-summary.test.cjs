const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
require('ts-node').register({ project: path.resolve(__dirname, '../../web/tsconfig.json'), transpileOnly: true,
    compilerOptions: { module: 'CommonJS', moduleResolution: 'node' } });

function mount(file, component, props) {
    const state = []; let cursor = 0;
    const React = {
        createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
        useState(initial) {
            const i = cursor++;
            if (!(i in state)) state[i] = initial;
            return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value; }];
        },
        useEffect() {},
    };
    const mod = { exports: {} };
    const source = fs.readFileSync(path.resolve(__dirname, '../../web/app/components', file), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: {
        jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
    } }).outputText;
    new Function('require', 'module', 'exports', 'React', code)(name => {
        if (name === 'react') return React;
        if (name === '@/lib/school-time') return { formatSchoolDateTime: value => value, getSchoolTimeZone: async () => 'Asia/Makassar' };
        if (name.startsWith('@/lib/')) return require(path.resolve(__dirname, '../../web/lib', name.slice(6) + '.ts'));
        return new Proxy({}, { get: (_, key) => String(key) });
    }, mod, mod.exports, React);
    return () => { cursor = 0; return mod.exports[component](props); };
}
const nodes = root => !root || typeof root !== 'object' ? [] : Array.isArray(root) ? root.flatMap(nodes) : [root, ...nodes(root.children)];
const text = root => root == null || typeof root === 'boolean' ? '' : typeof root !== 'object' ? String(root) : Array.isArray(root) ? root.map(text).join('') : text(root.children);
const now = '2026-10-15T06:00:00Z';
const attempt = () => ({ id: 'a', canReset: true, status: 'auto_submitted', profiles: { full_name: 'Andi', identity_number: '123' },
    kelas_name: 'XII C', saved_answer_count: 15, total_questions: 15, total_score: 90, warning_count: 2,
    started_at: '2026-10-15T05:00:00Z', deadline_at: now, finished_at: now, server_now: now, last_seen_at: now,
    sync_health: { localAnswerCount: 15, pendingAnswerCount: 0, storageState: 'healthy', receivedAt: now, fresh: true },
    monitoring_history: [], violation_breakdown: { pindah_tab: 1, close_tab: 0, lainnya: 0 } });

test('summary retains recovery and opens live details without navigating away', () => {
    let recovered; let viewed;
    const props = { attempts: [attempt()], defaultExpanded: true, onRecover: row => { recovered = row.id; }, onViewDetails: id => { viewed = id; } };
    const render = mount('MonitoringHealthPanel.tsx', 'MonitoringHealthPanel', props);
    let tree = render();
    assert.deepEqual(nodes(tree).filter(n => n.type === 'th').map(text), ['Peserta', 'Jawaban ↑', 'Status', 'Peringatan', 'Aksi']);
    const table = nodes(tree).find(n => n.type === 'table');
    assert.match(text(table), /15 \/ 15 terjawab/);
    assert.match(text(table), /Ditutup otomatis · sudah dinilai/);
    assert.doesNotMatch(text(table), /Penyimpanan|Antrean|Kontak server terakhir|Waktu sesi/);
    nodes(tree).find(n => n.type === 'button' && text(n) === 'Susulan / Pulihkan').props.onClick();
    assert.equal(recovered, 'a');
    nodes(tree).find(n => n.type === 'button' && text(n) === 'Detail').props.onClick();
    assert.equal(viewed, undefined);
    props.attempts = [{ ...props.attempts[0], warning_count: 3 }];
    tree = render();
    const detail = nodes(tree).find(n => n.type === 'AttemptHistoryModal');
    assert.equal(detail.props.open, true);
    assert.equal(detail.props.showSessionDetails, true);
    assert.equal(detail.props.attempt.warning_count, 3);
    detail.props.onViewAnswers('a');
    assert.equal(viewed, 'a');
    detail.props.onClose();
    assert.equal(nodes(render()).find(n => n.type === 'AttemptHistoryModal').props.open, false);
    delete props.onRecover;
    assert.equal(nodes(render()).some(n => n.type === 'button' && text(n) === 'Susulan / Pulihkan'), false);
});

test('detail keeps synchronization, timing, warning breakdown and answer navigation', () => {
    let viewed; let closed = false;
    const render = mount('monitoring/AttemptHistoryModal.tsx', 'AttemptHistoryModal', {
        open: true, attempt: attempt(), showSessionDetails: true, onClose: () => { closed = true; }, onViewAnswers: id => { viewed = id; },
    });
    const tree = render();
    for (const label of ['Jawaban lokal', 'Antrean pengiriman', 'Penyimpanan perangkat', 'Kontak server terakhir', 'Lama mengerjakan', 'Waktu sesi', 'Pindah tab 1']) assert.ok(text(tree).includes(label), label);
    nodes(tree).find(n => n.type === 'Button' && text(n) === 'Rincian jawaban').props.onClick();
    assert.equal(viewed, 'a'); assert.equal(closed, true);
});

test('active sessions show remaining time, pending sends, and authorized reset', () => {
    const row = attempt(); row.status = 'in_progress'; row.sync_health.pendingAnswerCount = 2;
    row.deadline_at = '2026-10-15T06:05:00Z';
    let resetId;
    const tree = mount('MonitoringHealthPanel.tsx', 'MonitoringHealthPanel', { attempts: [row], defaultExpanded: true, onRecover(attempt) { resetId = attempt.id; } })();
    assert.match(text(tree), /Sisa 5:00/);
    assert.match(text(tree), /2 jawaban menunggu dikirim/);
    nodes(tree).find(n => n.type === 'button' && text(n) === 'Reset sesi').props.onClick();
    assert.equal(resetId, row.id);
});

test('summary shows recovery only for students explicitly authorized by the server', () => {
    for (const canReset of [false, undefined]) {
        const row = { ...attempt(), canReset };
        const tree = mount('MonitoringHealthPanel.tsx', 'MonitoringHealthPanel', {
            attempts: [row], defaultExpanded: true, onRecover() { throw new Error('Unauthorized recovery'); },
        })();
        assert.match(text(tree), /Andi/);
        assert.equal(nodes(tree).some(n => n.type === 'button' && text(n) === 'Susulan / Pulihkan'), false);
    }
});
