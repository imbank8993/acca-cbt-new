const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../../web/tsconfig.json'), transpileOnly: true,
    compilerOptions: { module: 'CommonJS', moduleResolution: 'node' } });
const { monitoringTime, formatMonitoringDuration } = require('../../web/lib/monitoring-time.ts');
const session = { status: 'in_progress', started_at: '2026-10-14T05:54:39.464Z',
    deadline_at: '2026-10-14T07:00:00Z', server_now: '2026-10-14T06:02:41Z', remaining_seconds: 3439 };

test('screenshot clock reflects the schedule-capped session, not the nominal 90 minutes', () => {
    const clock = monitoringTime(session, 0);
    assert.equal(clock.remainingSeconds, 57 * 60 + 19);
    assert.equal(clock.workedSeconds, 8 * 60 + 1);
    assert.equal(clock.availableSeconds, 65 * 60 + 21);
    assert.ok(Math.abs(clock.workedSeconds + clock.remainingSeconds - clock.availableSeconds) <= 1);
    assert.equal(formatMonitoringDuration(clock.workedSeconds), '8m 1dtk');
    assert.equal(formatMonitoringDuration(clock.availableSeconds), '1j 5m 21dtk');
});
test('elapsed and remaining advance together using server timestamps, ignoring stale countdown fields', () => {
    const next = monitoringTime({ ...session, remaining_seconds: 9999 }, 15);
    assert.equal(next.remainingSeconds, 3424);
    assert.equal(next.workedSeconds, 496);
    assert.equal(next.availableSeconds, 3921);
});
test('time stops at submission or expiry and never invents negative remaining time', () => {
    const done = monitoringTime({ ...session, status: 'submitted', finished_at: '2026-10-14T06:01:00Z' }, 1000);
    assert.equal(done.remainingSeconds, null);
    assert.equal(done.workedSeconds, 380);
    const expired = monitoringTime({ ...session, status: 'auto_submitted', finished_at: '2026-10-14T07:03:00Z' }, 1000);
    assert.equal(expired.workedSeconds, 3920);
    assert.equal(monitoringTime(session, 9999).remainingSeconds, 0);
    assert.equal(monitoringTime(session, 9999).workedSeconds, 3920);
});
test('missing timestamps remain unknown and older API data can still count down', () => {
    assert.deepEqual(monitoringTime({ status: 'not_started' }, 15),
        { remainingSeconds: null, workedSeconds: null, availableSeconds: null });
    assert.equal(monitoringTime({ status: 'in_progress', remaining_seconds: 50 }, 15).remainingSeconds, 35);
    assert.equal(monitoringTime({ ...session, server_now: 'invalid', remaining_seconds: NaN }, 1).remainingSeconds, null);
    assert.equal(formatMonitoringDuration(null), '—');
});
