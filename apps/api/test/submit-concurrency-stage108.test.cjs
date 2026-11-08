// Run from repository root: node --test apps/api/test/submit-concurrency-stage108.test.cjs
// Pengumpulan serentak (200+ siswa): penilaian paralel, pool koneksi cukup, maxWait longgar.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('ts-node').register({
    project: path.resolve(__dirname, '../tsconfig.json'),
    transpileOnly: true,
});

const {
    advisoryTransactionLock,
    sharedAdvisoryTransactionLock,
} = require('../src/common/transaction-lock.ts');
const {
    withPoolDefaults,
    DEFAULT_DB_CONNECTION_LIMIT,
    DEFAULT_DB_POOL_TIMEOUT_SECONDS,
} = require('../src/prisma/database-url.ts');

const src = (relative) => fs.readFileSync(path.resolve(__dirname, '../src', relative), 'utf8');

/** Isi satu method kelas: dari penandanya sampai deklarasi method berikutnya. */
function method(source, startMarker) {
    const start = source.indexOf(startMarker);
    assert.notEqual(start, -1, `penanda tidak ditemukan: ${startMarker}`);
    const rest = source.slice(start + startMarker.length);
    const next = rest.search(/\n {4}(?:(?:public|private|protected) )?(?:async )?[A-Za-z]\w*\(/);
    return source.slice(start, next === -1 ? source.length : start + startMarker.length + next);
}

test('CONC-01: shared lock memakai pg_advisory_xact_lock_shared dengan hash yang sama dengan lock eksklusif', async () => {
    const calls = [];
    const db = { raw: async (...args) => { calls.push(args); return [{ locked: '' }]; } };

    await advisoryTransactionLock(db, 'exam-key-correction:x');
    await sharedAdvisoryTransactionLock(db, 'exam-key-correction:x');

    assert.match(calls[0][0], /pg_advisory_xact_lock\(/);
    assert.match(calls[1][0], /pg_advisory_xact_lock_shared\(/);
    // Kunci shared dan eksklusif hanya saling menunggu bila nilai kuncinya identik.
    const hashOf = (sql) => sql.match(/\((hashtextextended\([^)]*\))\)/)[1];
    assert.equal(hashOf(calls[1][0]), hashOf(calls[0][0]));
    assert.match(calls[1][0], /\)::text AS locked/i);
    assert.deepEqual(calls[1].slice(1), ['exam-key-correction:x']);
});

test('CONC-02: penilaian submit siswa memakai shared lock, bukan antrean eksklusif per ujian', () => {
    const attempts = src('students/exam-attempts.service.ts');
    const submit = method(attempts, 'private async submitInternal(');
    assert.match(submit, /sharedAdvisoryTransactionLock\(db, `exam-key-correction:\$\{examId\}`\)/);
    assert.doesNotMatch(submit, /[^d]advisoryTransactionLock\(db, `exam-key-correction/);
});

test('CONC-03: penilaian ulang dari jawaban tersimpan (auto-submit/worker) memakai shared lock', () => {
    const grading = src('grading/grading.service.ts');
    const fromSaved = method(grading, 'async gradeAttemptFromSavedAnswers(');
    assert.match(fromSaved, /sharedAdvisoryTransactionLock\(db, `exam-key-correction:\$\{examId\}`\)/);
});

test('CONC-04: koreksi kunci, revisi soal langsung, regrade, dan simpan IRT tetap eksklusif', () => {
    const exclusive = /[^d]advisoryTransactionLock\(db, `exam-key-correction:/;
    assert.match(src('grading/exam-key-correction.service.ts'), exclusive);
    assert.match(src('common/live-exam-question-updates.ts'), exclusive);
    const grading = src('grading/grading.service.ts');
    assert.match(method(grading, 'async retryLiveQuestionRegrades('), exclusive);
    // Simpan hasil IRT (bagian yang menulis kalibrasi) tetap memegang lock eksklusif.
    const exclusiveCount = (grading.match(/[^d]advisoryTransactionLock\(db, `exam-key-correction:/g) || []).length;
    assert.equal(exclusiveCount, 2);
    for (const file of ['grading/exam-key-correction.service.ts', 'common/live-exam-question-updates.ts']) {
        assert.doesNotMatch(src(file), /sharedAdvisoryTransactionLock/);
    }
});

test('CONC-05: DATABASE_URL tanpa pengaturan pool diberi pool yang cukup untuk ujian', () => {
    const url = 'postgresql://postgres:secret@host.docker.internal:5432/acca_db?schema=public';
    assert.equal(withPoolDefaults(url, {}),
        `${url}&connection_limit=${DEFAULT_DB_CONNECTION_LIMIT}&pool_timeout=${DEFAULT_DB_POOL_TIMEOUT_SECONDS}`);
    assert.ok(DEFAULT_DB_CONNECTION_LIMIT >= 25, 'pool harus jauh di atas bawaan Prisma (~13 di 6 core)');
    assert.equal(withPoolDefaults('postgresql://u:p@h/db', {}),
        `postgresql://u:p@h/db?connection_limit=${DEFAULT_DB_CONNECTION_LIMIT}&pool_timeout=${DEFAULT_DB_POOL_TIMEOUT_SECONDS}`);
});

test('CONC-06: nilai eksplisit di DATABASE_URL dan env dihormati; nilai env rusak diabaikan', () => {
    const explicit = 'postgresql://u:p@h/db?schema=public&connection_limit=50&pool_timeout=5';
    assert.equal(withPoolDefaults(explicit, { DB_CONNECTION_LIMIT: '10' }), explicit);
    assert.equal(withPoolDefaults('postgresql://u:p@h/db?connection_limit=50', {}),
        `postgresql://u:p@h/db?connection_limit=50&pool_timeout=${DEFAULT_DB_POOL_TIMEOUT_SECONDS}`);
    assert.equal(withPoolDefaults('postgresql://u:p@h/db', { DB_CONNECTION_LIMIT: '40', DB_POOL_TIMEOUT: '15' }),
        'postgresql://u:p@h/db?connection_limit=40&pool_timeout=15');
    assert.equal(withPoolDefaults('postgresql://u:p@h/db', { DB_CONNECTION_LIMIT: 'banyak', DB_POOL_TIMEOUT: '-1' }),
        `postgresql://u:p@h/db?connection_limit=${DEFAULT_DB_CONNECTION_LIMIT}&pool_timeout=${DEFAULT_DB_POOL_TIMEOUT_SECONDS}`);
    assert.equal(withPoolDefaults(undefined, {}), undefined);
    assert.equal(withPoolDefaults('', {}), '');
});

test('CONC-07: kata sandi dengan karakter khusus tidak diubah', () => {
    const url = 'postgresql://postgres:p%40ss%3Aw0rd@host:5432/acca_db?schema=public';
    assert.ok(withPoolDefaults(url, {}).startsWith(url + '&'));
});

test('CONC-08: PrismaService memakai URL berpool; transaksi menunggu koneksi lebih dari 2 detik', async () => {
    const service = src('prisma/prisma.service.ts');
    assert.match(service, /withPoolDefaults\(process\.env\.DATABASE_URL\)/);
    assert.match(service, /super\(prismaClientOptions\(\)\)/);

    const { DbService, TRANSACTION_MAX_WAIT_MS, TRANSACTION_TIMEOUT_MS } =
        require('../src/prisma/prisma-db-adapter.ts');
    let received;
    const prisma = {
        $transaction: async (work, options) => { received = options; return work({ $queryRawUnsafe: async () => [] }); },
    };
    const db = new DbService(prisma, {});
    assert.equal(await db.transaction(async () => 'ok'), 'ok');
    assert.ok(received.maxWait >= 10_000, `maxWait terlalu kecil: ${received.maxWait}`);
    assert.equal(received.maxWait, TRANSACTION_MAX_WAIT_MS);
    assert.equal(received.timeout, TRANSACTION_TIMEOUT_MS);
    assert.equal(TRANSACTION_TIMEOUT_MS, 30_000);
});
