const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
require('ts-node').register({ project: path.resolve(__dirname, '../../web/tsconfig.json'), transpileOnly: true,
    compilerOptions: { module: 'CommonJS', moduleResolution: 'node' } });
const { keepExamScreenAwake } = require('../../web/lib/exam-wake-lock.ts');
const tick = () => new Promise(resolve => setImmediate(resolve));
class Page extends EventTarget { visibilityState = 'visible'; }
function fixture() {
    const doc = new Page();
    const locks = [];
    const nav = { wakeLock: { request: async type => {
        assert.equal(type, 'screen');
        const lock = { released: false, listener: null,
            addEventListener: (_, listener) => { lock.listener = listener; },
            release: async () => { lock.released = true; lock.listener?.(); } };
        locks.push(lock);
        return lock;
    } } };
    return { doc, nav, locks };
}
test('screen lock is reacquired on return and released when the exam ends', async () => {
    const { doc, nav, locks } = fixture();
    const stop = keepExamScreenAwake(nav, doc);
    await tick();
    doc.dispatchEvent(new Event('pointerdown'));
    await tick();
    assert.equal(locks.length, 1);
    doc.visibilityState = 'hidden';
    await locks[0].release();
    doc.dispatchEvent(new Event('visibilitychange'));
    await tick();
    assert.equal(locks.length, 1);
    doc.visibilityState = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
    await tick();
    assert.equal(locks.length, 2);
    stop();
    assert.equal(locks[1].released, true);
    doc.dispatchEvent(new Event('pointerdown'));
    await tick();
    assert.equal(locks.length, 2);
});
test('late acquisition after cleanup releases the lock without leaking it', async () => {
    const { doc, locks, nav } = fixture();
    let resolve;
    const original = nav.wakeLock.request;
    nav.wakeLock.request = () => new Promise(r => { resolve = r; });
    const stop = keepExamScreenAwake(nav, doc);
    stop();
    resolve(await original('screen'));
    await tick();
    assert.equal(locks[0].released, true);
});
test('unsupported and denied locks do not block the exam; gesture retries denial', async () => {
    keepExamScreenAwake({}, new Page())();
    const doc = new Page();
    let count = 0;
    const stop = keepExamScreenAwake({ wakeLock: { request: async () => { count++; throw new Error('Denied'); } } }, doc);
    await tick();
    doc.dispatchEvent(new Event('pointerdown'));
    await tick();
    assert.equal(count, 2);
    stop();
});
test('delayed blur after a screen lock cannot count a second violation', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../web/app/components/questions/ExamPage.tsx'), 'utf8');
    const body = source.match(/blurTimeout = setTimeout\(\(\) => \{([\s\S]*?)\}, 5000\);/)[1];
    const events = [];
    const callback = new Function('document', 'handleSecurityViolation', body);
    callback({ hidden: true }, type => events.push(type));
    assert.deepEqual(events, []);
    callback({ hidden: false }, type => events.push(type));
    assert.deepEqual(events, ['focus_interruption']);
});

test('fullscreen loss with OS focus loss is technical; focused exit remains a violation', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../web/app/components/questions/ExamPage.tsx'), 'utf8');
    const body = source.match(/const onFullscreenChange = \(\) => \{([\s\S]*?)\n        \};/)[1];
    const callback = new Function('document', 'hasExamFullscreen', 'handleSecurityViolation', body);
    for (const [hidden, fullscreen, focused, expected] of [
        [false, false, false, ['focus_interruption']], [false, false, true, ['exit_fullscreen']],
        [true, false, false, []], [false, true, true, []],
    ]) {
        const events = [];
        callback({ hidden, hasFocus: () => focused }, () => fullscreen, type => events.push(type));
        assert.deepEqual(events, expected);
    }
});
