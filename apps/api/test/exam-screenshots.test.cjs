const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Readable } = require('node:stream');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { fixtureDb } = require('./fixture-db.cjs');
const { ExamScreenshotsService, decodeScreenshot, screenshotKey, encryptScreenshot, decryptScreenshot } = require('../src/proctoring/exam-screenshots.service.ts');
const { ExamAttemptsService } = require('../src/students/exam-attempts.service.ts');
const { StorageAccessService } = require('../src/storage/storage-access.service.ts');
const jpeg = Buffer.from([255, 216, 255, 224, 0, 0, 255, 217]);
const encoded = jpeg.toString('base64');
const device = 'device-screenshot-test';
function fixture(failedTables = []) {
 const now = new Date().toISOString();
 const db = fixtureDb({
  cbt_exams: [{ id: 'exam', metadata: { screenshot_enabled: true } }],
  cbt_exam_attempts: [{ id: 'attempt', user_id: 'student', exam_id: 'exam', device_fingerprint: device, status: 'in_progress' }],
  cbt_attempt_security_logs: [{ id: 'event', attempt_id: 'attempt', event_type: 'tab_switch', created_at: now, metadata: { client_event_id: 'client-event', source: 'student' } }],
 }, failedTables, { now });
 const images = new Map(); const deleted = []; let sweeps = 0;
 const storage = {
  status: () => ({ configured: true }),
  putObject: async (key, bytes, mime) => { assert.equal(mime, 'application/octet-stream'); images.set(key, bytes); return { success: true }; },
  deleteObject: async key => { deleted.push(key); images.delete(key); return { success: true }; },
  getObject: async key => images.has(key) ? { stream: Readable.from([images.get(key)]), contentType: 'application/octet-stream' } : null,
  deleteExpiredEvidenceObjects: async date => { assert.ok(date instanceof Date); sweeps++; },
 };
 const auth = { assertExamMonitoring: async user => {
  if (user.id === 'outside') throw new Error('No monitoring permission');
  return user.id === 'guard-other-room' ? ['other'] : user.id === 'guard' ? ['student'] : undefined;
 } };
 const config = { get: name => name === 'JWT_SECRET' ? 'a-long-encryption-secret-for-tests' : undefined };
 const service = new ExamScreenshotsService(db, auth, storage, config);
 return { db, images, storage, deleted, service, sweepCount: () => sweeps };
}
const upload = (f, user = { id: 'student' }, event = 'client-event', image = encoded, fingerprint = device) => f.service.upload(user, 'attempt', event, fingerprint, image);

test('screenshots are size bounded, binary validated, and authenticated encryption prevents public-bucket disclosure', () => {
 assert.deepEqual(decodeScreenshot(encoded).image, jpeg);
 for (const value of ['<script>bad</script>', Buffer.alloc(204801).toString('base64'), Buffer.from('<html>bad</html>').toString('base64'), 'bad==']) assert.throws(() => decodeScreenshot(value));
 const key = screenshotKey('a-long-encryption-secret-for-tests');
 const cipher = encryptScreenshot(jpeg, key);
 assert.notDeepEqual(cipher, jpeg);
 assert.deepEqual(decryptScreenshot(cipher, key), jpeg);
 const tampered = Buffer.from(cipher); tampered[29] ^= 1;
 assert.throws(() => decryptScreenshot(tampered, key));
});

test('upload requires the attempt owner, bound device, enabled feature and an actual recent student event', async () => {
 for (const change of [
  f => { f.db.tables.cbt_exams[0].metadata.screenshot_enabled = false; },
  f => { f.db.tables.cbt_exam_attempts[0].user_id = 'other'; },
  f => { f.db.tables.cbt_exam_attempts[0].device_fingerprint = 'other-device'; },
  f => { f.db.tables.cbt_attempt_security_logs[0].event_type = 'focus_interruption'; },
  f => { f.db.tables.cbt_attempt_security_logs[0].created_at = '2020-01-01'; },
  f => { f.db.tables.cbt_attempt_security_logs[0].metadata.source = 'staff'; },
 ]) {
  const f = fixture(); change(f);
  await assert.rejects(upload(f)); assert.equal(f.images.size, 0); assert.equal(f.db.writes.length, 0);
 }
});

test('saved screenshots replay idempotently; altered payloads never replace earlier evidence', async () => {
 const f = fixture(); const first = await upload(f); const replay = await upload(f);
 assert.equal(first.id, replay.id); assert.equal(f.images.size, 1); assert.equal(f.db.tables.cbt_exam_screenshots.length, 1);
 assert.notDeepEqual([...f.images.values()][0], jpeg);
 const different = Buffer.from(jpeg); different[4] = 1;
 await assert.rejects(upload(f, undefined, undefined, different.toString('base64')), /sudah tersimpan/);
 assert.equal(f.images.size, 1);
 const row = f.db.tables.cbt_exam_screenshots[0];
 assert.equal(Date.parse(row.expires_at) - Date.parse(row.created_at), 7 * 86400000);
});

test('the last violation screenshot can still be saved after automatic submission', async () => {
 const f = fixture();
 f.db.tables.cbt_exam_attempts[0].status = 'auto_submitted';
 const result = await upload(f);
 assert.equal(result.saved, true);
 assert.equal(f.db.tables.cbt_exam_screenshots.length, 1);
});

test('quota and cooldown are enforced by the server even after browser reload; records survive image expiration', async () => {
 const f = fixture();
 f.db.tables.cbt_exam_screenshots = Array.from({ length: 10 }, (_, i) => ({ id: 'old-' + i, attempt_id: 'attempt', created_at: '2020-01-01', deleted_at: '2020-01-08' }));
 assert.deepEqual(await upload(f), { saved: false, reason: 'limit' }); assert.equal(f.images.size, 0);
 f.db.tables.cbt_exam_screenshots = [{ id: 'recent', attempt_id: 'attempt', created_at: new Date().toISOString() }];
 assert.deepEqual(await upload(f), { saved: false, reason: 'cooldown' }); assert.equal(f.images.size, 0);
});

test('reset and makeup start a fresh screenshot quota while rejecting delayed evidence from the previous run', async () => {
 for (const resetType of ['RESET_BY_PROCTOR', 'MAKEUP_EXAM_STARTED']) {
  const f = fixture();
  const now = Date.now();
  const before = new Date(now - 5 * 60_000).toISOString();
  const resetAt = new Date(now - 2 * 60_000).toISOString();
  const after = new Date(now - 60_000).toISOString();
  f.db.tables.cbt_attempt_security_logs = [
   { id: 'old-event', attempt_id: 'attempt', event_type: 'tab_switch', created_at: before,
    metadata: { client_event_id: 'old', source: 'student', timestamp: before } },
   { id: 'reset', attempt_id: 'attempt', event_type: resetType, created_at: resetAt, metadata: {} },
   { id: 'new-event', attempt_id: 'attempt', event_type: 'tab_switch', created_at: after,
    metadata: { client_event_id: 'new', source: 'student', timestamp: before } },
  ];
  f.db.tables.cbt_exam_screenshots = Array.from({ length: 10 }, (_, i) => ({
   id: `old-${i}`, attempt_id: 'attempt', created_at: before, deleted_at: before,
  }));
  await assert.rejects(upload(f, { id: 'student' }, 'old'), /sesi ujian sebelumnya/);
  const current = await upload(f, { id: 'student' }, 'new');
  assert.equal(current.saved, true);
  assert.equal(f.db.tables.cbt_exam_screenshots.length, 11);
  assert.ok(Date.parse(f.db.tables.cbt_exam_screenshots[10].created_at) > Date.parse(resetAt));
  f.db.tables.cbt_attempt_security_logs.push({ id: 'new-event-2', attempt_id: 'attempt',
   event_type: 'exit_fullscreen', created_at: new Date(now).toISOString(),
   metadata: { client_event_id: 'new-2', source: 'student', timestamp: before } });
  assert.deepEqual(await upload(f, { id: 'student' }, 'new-2'), { saved: false, reason: 'cooldown' });
  f.db.tables.cbt_exam_screenshots.push(...Array.from({ length: 9 }, (_, i) => ({
   id: `current-${i}`, attempt_id: 'attempt', created_at: after,
  })));
  assert.deepEqual(await upload(f, { id: 'student' }, 'new-2'), { saved: false, reason: 'limit' });
 }
});

test('a database failure after object upload removes the encrypted orphan and rolls back records', async () => {
 const f = fixture(['cbt_exam_screenshots']);
 await assert.rejects(upload(f)); assert.equal(f.images.size, 0);
 const g = fixture(); const original = g.db.from.bind(g.db);
 g.db.from = table => {
  const query = original(table);
  if (table !== 'cbt_exam_screenshots') return query;
  return new Proxy(query, { get(target, prop) {
   if (prop === 'insert') return () => Promise.resolve({ data: null, error: { message: 'write failed' } });
   return target[prop];
  } });
 };
 await assert.rejects(upload(g), /Catatan screenshot/);
 assert.equal(g.images.size, 0); assert.equal(g.deleted.length, 1);
});

test('only authorized monitoring staff can read decrypted evidence; students, other rooms and expired links are denied', async () => {
 const f = fixture(); const saved = await upload(f);
 for (const id of ['student', 'outside', 'guard-other-room']) {
  await assert.rejects(f.service.list({ id }, 'attempt'));
  await assert.rejects(f.service.read({ id }, saved.id));
 }
 assert.equal((await f.service.list({ id: 'guard' }, 'attempt'))[0].available, true);
 assert.deepEqual((await f.service.read({ id: 'guard' }, saved.id)).body, jpeg);
 f.db.tables.cbt_exam_screenshots[0].expires_at = '2020-01-01';
 await assert.rejects(f.service.read({ id: 'guard' }, saved.id), /Masa simpan/);
 await assert.rejects(new StorageAccessService({}, {}, {}).assertRead({ id: 'admin' }, 'exam-evidence/a.bin'), /terotorisasi/);
});

test('cleanup deletes expired images while preserving event history and active evidence', async () => {
 const f = fixture(); await upload(f);
 const activeKey = [...f.images.keys()][0];
 f.images.set('exam-evidence/old.bin', Buffer.from('old'));
 f.db.tables.cbt_exam_screenshots.push({ id: 'old', attempt_id: 'attempt', object_key: 'exam-evidence/old.bin', expires_at: '2020-01-01', deleted_at: null });
 await f.service.cleanup();
 assert.ok(f.images.has(activeKey)); assert.equal(f.images.has('exam-evidence/old.bin'), false);
 assert.ok(f.db.tables.cbt_exam_screenshots.find(row => row.id === 'old').deleted_at);
 assert.equal(f.db.tables.cbt_attempt_security_logs.length, 1); assert.equal(f.sweepCount(), 1);
});

test('enabled exams require screen-sharing readiness before starting or resuming; disabled exams retain the original path', async () => {
 const db = fixtureDb({
  cbt_exams: [{ id: 'exam', organization_id: 'school', is_published: true, metadata: { is_public: true, screenshot_enabled: true }, end_time: '2030-01-01', duration_minutes: 60 }],
  cbt_organization_members: [{ user_id: 'student', organization_id: 'school', is_active: true }],
 });
 const service = new ExamAttemptsService(db, {}, {});
 await assert.rejects(service.start({ id: 'student' }, 'exam', device), /Bagikan seluruh layar/);
 assert.equal(db.writes.length, 0);
 const started = await service.start({ id: 'student' }, 'exam', device, true);
 assert.equal(started.started, true);
 await assert.rejects(service.start({ id: 'student' }, 'exam', device, false), /Bagikan seluruh layar/);
 db.tables.cbt_exams[0].metadata.screenshot_enabled = false;
 assert.equal((await service.start({ id: 'student' }, 'exam', device)).started, true);
});

test('offline queued screenshots survive reconnect burst upload when captured >= 30s apart while enforcing cooldown for closer events', async () => {
 const f = fixture();
 const nowMs = Date.now();
 const t1 = new Date(nowMs - 5 * 60 * 1000).toISOString();
 const t2 = new Date(nowMs - 4 * 60 * 1000).toISOString();
 const tTooClose = new Date(nowMs - 4 * 60 * 1000 + 10_000).toISOString();
 f.db.tables.cbt_attempt_security_logs = [
  { id: 'ev-1', attempt_id: 'attempt', event_type: 'tab_switch', created_at: new Date(nowMs - 5 * 60 * 1000).toISOString(), metadata: { client_event_id: 'offline-1', source: 'student', timestamp: t1 } },
  { id: 'ev-2', attempt_id: 'attempt', event_type: 'exit_fullscreen', created_at: new Date(nowMs).toISOString(), metadata: { client_event_id: 'offline-2', source: 'student', timestamp: t2 } },
  { id: 'ev-3', attempt_id: 'attempt', event_type: 'restricted_shortcut', created_at: new Date(nowMs).toISOString(), metadata: { client_event_id: 'offline-3', source: 'student', timestamp: tTooClose } },
 ];
 const first = await upload(f, { id: 'student' }, 'offline-1');
 const second = await upload(f, { id: 'student' }, 'offline-2');
 const third = await upload(f, { id: 'student' }, 'offline-3');
 assert.equal(first.saved, true);
 assert.equal(second.saved, true);
 assert.deepEqual(third, { saved: false, reason: 'cooldown' });
 assert.equal(f.db.tables.cbt_exam_screenshots.length, 2);
 assert.equal(f.db.tables.cbt_exam_screenshots[0].created_at, t1);
 assert.equal(f.db.tables.cbt_exam_screenshots[1].created_at, t2);
});

test('durable security queue persists screenshotBase64 and falls back gracefully if localStorage quota is exceeded', async () => {
 const securityStorage = require('../../web/lib/exam-durable-storage.ts');
 const values = new Map();
 let throwOnLargePayload = false;
 const prevIdb = global.indexedDB;
 const prevLocal = global.localStorage;
 delete global.indexedDB;
 global.localStorage = {
  getItem: key => values.get(key) ?? null,
  setItem: (key, value) => {
   if (throwOnLargePayload && value.includes(encoded)) throw new Error('QuotaExceededError');
   values.set(key, value);
  },
  removeItem: key => values.delete(key),
 };
 try {
  const baseEvent = {
   id: 'offline-ss-event',
   attemptId: 'attempt-ss',
   eventType: 'tab_switch',
   metadata: { timestamp: '2026-10-17T03:00:00.000Z' },
   createdAt: '2026-10-17T03:00:00.000Z',
  };
  await securityStorage.enqueueSecurityEvent(baseEvent);
  await securityStorage.enqueueSecurityEvent({ ...baseEvent, screenshotBase64: encoded });
  const queued = await securityStorage.readSecurityEvents('attempt-ss');
  assert.equal(queued.length, 1);
  assert.equal(queued[0].screenshotBase64, encoded);

  // Even if localStorage rejects the large screenshot payload, the security event itself is still preserved.
  throwOnLargePayload = true;
  const fallbackWrite = await securityStorage.enqueueSecurityEvent({
   id: 'offline-ss-event-2',
   attemptId: 'attempt-ss',
   eventType: 'exit_fullscreen',
   metadata: { timestamp: '2026-10-17T03:01:00.000Z' },
   createdAt: '2026-10-17T03:01:00.000Z',
   screenshotBase64: encoded,
  });
  assert.equal(fallbackWrite.saved, true);
  const afterQuota = await securityStorage.readSecurityEvents('attempt-ss');
  assert.equal(afterQuota.length, 2);
 } finally {
  if (prevIdb !== undefined) global.indexedDB = prevIdb;
  if (prevLocal === undefined) delete global.localStorage; else global.localStorage = prevLocal;
 }
});

