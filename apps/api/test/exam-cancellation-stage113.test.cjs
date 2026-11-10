// Run from repository root: node --test apps/api/test/exam-cancellation-stage113.test.cjs
// Pembatalan ujian: arsip + hapus pengerjaan, tarik ke draf, dan 410 untuk perangkat siswa.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { lastValueFrom, throwError, of } = require('rxjs');
const { ForbiddenException, NotFoundException, GoneException, BadRequestException } = require('@nestjs/common');
const core = require('../src/common/exam-cancellation.ts');
const { ExamCancellationService } = require('../src/proctor/exam-cancellation.service.ts');
const { CancelledAttemptInterceptor } = require('../src/common/interceptors/cancelled-attempt.interceptor.ts');

const api = (relative) => fs.readFileSync(path.resolve(__dirname, '../src', relative), 'utf8');
const web = (relative) => fs.readFileSync(path.resolve(__dirname, '../../web', relative), 'utf8');

const EXAM = '11111111-1111-4111-8111-111111111111';
const ATTEMPT = '22222222-2222-4222-8222-222222222222';
const STUDENT = '33333333-3333-4333-8333-333333333333';

/** DB palsu: mencatat SQL, menjawab query katalog/arsip sesuai skenario. */
function fakeDb({ archive = true, attempts = [{ id: ATTEMPT, status: 'in_progress' }], exam = { id: EXAM, title: 'PAS Matematika', is_published: true, status: 'active' },
    metadata = { irt_calibration: { a: 1 }, keep: 'ya' }, cancelledFor = null } = {}) {
    const sql = [];
    const updates = [];
    const raw = async (text, ...params) => {
        sql.push({ text: text.replace(/\s+/g, ' ').trim(), params });
        if (/to_regclass/.test(text)) return [{ ok: archive }];
        if (/FROM public\.cbt_exams WHERE id = \$1::uuid FOR UPDATE/.test(text)) return exam ? [exam] : [];
        if (/FROM public\.cbt_exam_attempts WHERE exam_id = \$1::uuid ORDER BY id FOR UPDATE/.test(text)) return attempts;
        if (/FROM pg_constraint c JOIN pg_attribute/.test(text.replace(/\s+/g, ' '))) {
            return [{ table: 'cbt_answers', column: 'attempt_id' }, { table: 'cbt_attempt_security_logs', column: 'attempt_id' }, { table: 'cbt_exam_screenshots', column: 'attempt_id' }];
        }
        if (/AS child/.test(text)) return [{ child: 'cbt_exam_screenshots', parent: 'cbt_attempt_security_logs' }];
        if (/UPDATE public\.cbt_exam_cancelled_attempts/.test(text)) return params[2] === 'cbt_answers' ? [{ n: 7 }] : [{ n: 1 }];
        if (/information_schema\.columns/.test(text)) return [{ ok: false }];
        if (/FROM public\.cbt_exam_cancelled_attempts WHERE attempt_id/.test(text)) {
            return cancelledFor && params[0] === cancelledFor.attemptId && params[1] === cancelledFor.userId ? [{ id: params[0] }] : [];
        }
        return [];
    };
    const from = (table) => {
        const q = {
            select: () => q, eq: () => q,
            maybeSingle: async () => ({ data: table === 'cbt_exams' ? { metadata } : null, error: null }),
            update: (values) => { updates.push({ table, values }); return { eq: async () => ({ error: null }) }; },
        };
        return q;
    };
    const db = { raw, from, sql, updates, transaction: async (work) => work({ raw, from }) };
    return db;
}
const authz = () => {
    const calls = [];
    return { calls, assertResourceOwner: async (...a) => { calls.push(['owner', ...a.slice(1)]); }, assertExamStaff: async (...a) => { calls.push(['staff', ...a.slice(1)]); } };
};
const user = { id: '44444444-4444-4444-8444-444444444444' };

test('CANCEL-01: membatalkan mengarsipkan, menghapus berurutan, dan menarik ujian ke draf', async () => {
    core.resetCancellationArchiveCache();
    const db = fakeDb();
    const auth = authz();
    const result = await new ExamCancellationService(db, auth).cancel(user, EXAM, '  Jadwal salah, ujian diulang  ', ' PAS Matematika ');
    assert.deepEqual({ ...result, cancellationId: typeof result.cancellationId }, {
        examId: EXAM, cancellationId: 'string', attemptCount: 1, inProgressCount: 1, answerCount: 7, isPublished: false,
    });
    assert.deepEqual(auth.calls, [['owner', 'exam', EXAM], ['staff', EXAM]]);

    const texts = db.sql.map(row => row.text);
    const idx = (re) => texts.findIndex(text => re.test(text));
    const locks = db.sql.filter(row => /pg_advisory_xact_lock\(/.test(row.text)).map(row => row.params[0]);
    assert.deepEqual(locks, [`exam-start:${EXAM}`, `exam-key-correction:${EXAM}`], 'kunci mulai dan kunci penilaian eksklusif');
    assert.ok(idx(/FOR UPDATE$/) < idx(/INSERT INTO public\.cbt_exam_cancellations/));
    assert.ok(idx(/INSERT INTO public\.cbt_exam_cancelled_attempts/) < idx(/DELETE FROM cbt_answers/), 'arsip sebelum hapus');
    assert.ok(idx(/DELETE FROM cbt_exam_screenshots/) < idx(/DELETE FROM cbt_attempt_security_logs/), 'anak dihapus lebih dulu');
    assert.ok(idx(/DELETE FROM cbt_attempt_security_logs/) < idx(/DELETE FROM public\.cbt_exam_attempts/));
    const insert = db.sql.find(row => /INSERT INTO public\.cbt_exam_cancellations/.test(row.text));
    assert.equal(insert.params[3], 'Jadwal salah, ujian diulang');
    assert.deepEqual(JSON.parse(insert.params[7]), { is_published: true, status: 'active', irt_calibration: { a: 1 } });

    assert.equal(db.updates.length, 1);
    const { values } = db.updates[0];
    assert.equal(values.is_published, false);
    assert.equal(values.status, 'draft');
    assert.equal(values.metadata.irt_calibration, undefined, 'kalibrasi IRT lama dibuang');
    assert.equal(values.metadata.keep, 'ya');
    assert.equal(values.metadata.last_cancellation.attempt_count, 1);
});

test('CANCEL-02: penolakan — alasan, judul, migrasi, dan ujian tanpa pengerjaan', async () => {
    core.resetCancellationArchiveCache();
    const service = (db) => new ExamCancellationService(db, authz());
    await assert.rejects(service(fakeDb()).cancel(user, EXAM, 'ok', 'PAS Matematika'), BadRequestException);
    await assert.rejects(service(fakeDb()).cancel(user, EXAM, 'Jadwal salah', 'PAS Fisika'), /Judul konfirmasi/);
    core.resetCancellationArchiveCache();
    const noArchive = fakeDb({ archive: false });
    await assert.rejects(service(noArchive).cancel(user, EXAM, 'Jadwal salah', 'PAS Matematika'), /20261110_01/);
    assert.equal(noArchive.sql.some(row => /cbt_exam_cancell/.test(row.text) && !/to_regclass/.test(row.text)), false,
        'tanpa migrasi tidak ada query ke tabel arsip');
    core.resetCancellationArchiveCache();
    const empty = fakeDb({ attempts: [] });
    await assert.rejects(service(empty).cancel(user, EXAM, 'Jadwal salah', 'PAS Matematika'), /Belum ada siswa/);
    assert.equal(empty.updates.length, 0);
    await assert.rejects(service(fakeDb({ exam: null })).cancel(user, EXAM, 'Jadwal salah', 'x'), NotFoundException);
    const archived = fakeDb({ exam: { id: EXAM, title: 'PAS Matematika', is_published: false, status: 'archived' } });
    await service(archived).cancel(user, EXAM, 'Jadwal salah', 'PAS Matematika');
    assert.equal(archived.updates[0].values.status, 'archived', 'ujian arsip tetap di arsip');
});

test('CANCEL-03: urutan hapus mengikuti foreign key antar tabel anak', () => {
    assert.deepEqual(core.deletionOrder(['cbt_answers', 'cbt_attempt_security_logs', 'cbt_exam_screenshots'],
        [{ child: 'cbt_exam_screenshots', parent: 'cbt_attempt_security_logs' }]),
    ['cbt_answers', 'cbt_exam_screenshots', 'cbt_attempt_security_logs']);
    assert.deepEqual(core.deletionOrder(['a', 'b'], [{ child: 'a', parent: 'b' }, { child: 'b', parent: 'a' }]).length, 2, 'siklus tidak macet');
});

function context({ params = {}, body = {}, userId = STUDENT } = {}) {
    return { switchToHttp: () => ({ getRequest: () => ({ user: userId ? { id: userId } : undefined, params, body }) }) };
}
const run = (interceptor, ctx, error) => lastValueFrom(interceptor.intercept(ctx, { handle: () => throwError(() => error) }));

test('CANCEL-04: perangkat siswa menerima 410 EXAM_CANCELLED untuk attempt yang dibatalkan', async () => {
    core.resetCancellationArchiveCache();
    const db = fakeDb({ cancelledFor: { attemptId: ATTEMPT, userId: STUDENT } });
    const interceptor = new CancelledAttemptInterceptor(db);
    await assert.rejects(run(interceptor, context({ params: { attemptId: ATTEMPT } }), new NotFoundException('Pengerjaan tidak ditemukan.')), (error) => {
        assert.ok(error instanceof GoneException);
        assert.equal(error.getResponse().code, core.EXAM_CANCELLED_CODE);
        return true;
    });
    // Kumpul ujian membawa attemptId di body.
    await assert.rejects(run(interceptor, context({ body: { attemptId: ATTEMPT } }), new ForbiddenException('x')), GoneException);
    // Pengguna lain, attempt lain, galat lain, atau sukses: tidak diubah.
    await assert.rejects(run(interceptor, context({ params: { attemptId: ATTEMPT }, userId: user.id }), new ForbiddenException('x')), ForbiddenException);
    await assert.rejects(run(interceptor, context({ params: { attemptId: 'bukan-uuid' } }), new ForbiddenException('x')), ForbiddenException);
    await assert.rejects(run(interceptor, context({ params: { attemptId: ATTEMPT } }), new Error('db')), /db/);
    assert.equal(await lastValueFrom(interceptor.intercept(context({ params: { attemptId: ATTEMPT } }), { handle: () => of({ ok: 1 }) })).then(v => v.ok), 1);
    // Tanpa migrasi: galat asli.
    core.resetCancellationArchiveCache();
    await assert.rejects(run(new CancelledAttemptInterceptor(fakeDb({ archive: false })), context({ params: { attemptId: ATTEMPT } }), new ForbiddenException('x')), ForbiddenException);
});

test('CANCEL-05: attempt baru tidak dapat terselip saat pembatalan; endpoint dan UI terpasang', () => {
    const attempts = api('students/exam-attempts.service.ts');
    const safely = attempts.slice(attempts.indexOf('private async createAttemptSafely('));
    assert.match(safely, /advisoryTransactionLock\(db, `\$\{examId\}:\$\{user\.id\}`\);\s*\/\/[^]*?sharedAdvisoryTransactionLock\(db, examStartLockKey\(examId\)\)/);
    assert.match(safely, /kind: 'unpublished'/);
    assert.match(attempts, /decision\.kind === 'unpublished'/);
    assert.match(api('students/students.controller.ts'), /@UseInterceptors\(CancelledAttemptInterceptor\)\s*export class StudentsController/);
    assert.match(api('proctoring/proctoring.controller.ts'), /@UseInterceptors\(CancelledAttemptInterceptor\)\s*export class ProctoringController/);
    assert.match(api('proctor/proctor.controller.ts'), /@Post\('exams\/:examId\/cancel'\)/);
    assert.match(api('proctor/proctor.module.ts'), /ExamCancellationService\]/);

    assert.match(web('lib/api/client.ts'), /response\.status === 410 \? \{ cancelled: true \}/);
    assert.match(web('app/api/proctor/exams/[examId]/cancel/route.ts'), /\/proctor\/exams\/\$\{encodeURIComponent\(examId\)\}\/cancel/);
    const page = web('app/components/questions/ExamPage.tsx');
    assert.match(page, /res\.cancelled/);
    assert.match(page, /discardExamLocalCopy/);
    assert.match(web('lib/exam-submission-worker.ts'), /status\.cancelled/);
    assert.match(web('app/components/monitoring/ParticipantsWorkspace.tsx'), /CancelExamModal/);
});
