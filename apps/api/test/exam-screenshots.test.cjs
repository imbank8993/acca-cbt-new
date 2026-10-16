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

test('quota and cooldown are enforced by the server even after browser reload; records survive image expiration', async () => {
 const f = fixture();
 f.db.tables.cbt_exam_screenshots = Array.from({ length: 10 }, (_, i) => ({ id: 'old-' + i, attempt_id: 'attempt', created_at: '2020-01-01', deleted_at: '2020-01-08' }));
 assert.deepEqual(await upload(f), { saved: false, reason: 'limit' }); assert.equal(f.images.size, 0);
 f.db.tables.cbt_exam_screenshots = [{ id: 'recent', attempt_id: 'attempt', created_at: new Date().toISOString() }];
 assert.deepEqual(await upload(f), { saved: false, reason: 'cooldown' }); assert.equal(f.images.size, 0);
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
