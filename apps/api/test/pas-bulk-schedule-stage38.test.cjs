// Run from repository root: node apps/api/test/pas-bulk-schedule-stage38.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('ts-node').register({
    project: path.resolve(__dirname, '../../web/tsconfig.json'),
    transpileOnly: true,
    compilerOptions: { module: 'CommonJS', moduleResolution: 'Node' },
});

const {
    saveBulkScheduleRows,
    resolveBankSubjectId,
    parseImportedScheduleRows,
} = require('../../web/lib/pas/bulk-schedule.ts');

function row(id, changes = {}) {
    return {
        id,
        subject_id: 'subject-1',
        class_id: `class-${id}`,
        bank_id: 'bank-1',
        date: '2026-09-20',
        session_id: 'session-1',
        room: '',
        status: 'idle',
        ...changes,
    };
}

test('BULK-01: hasil success false dicatat sebagai kegagalan baris', async () => {
    const result = await saveBulkScheduleRows('period-1', [row('1')], async () => ({
        success: false,
        error: 'Bank soal tidak ditemukan.',
    }));

    assert.deepEqual(result.outcomes, [{
        rowId: '1', success: false, error: 'Bank soal tidak ditemukan.',
    }]);
});

test('BULK-02: retry tidak mengirim ulang baris yang sudah tersimpan', async () => {
    const sent = [];
    const result = await saveBulkScheduleRows('period-1', [
        row('saved', { status: 'saved' }),
        row('retry'),
    ], async (input) => {
        sent.push(input.class_id);
        return { success: true };
    });

    assert.deepEqual(sent, ['class-retry']);
    assert.deepEqual(result.outcomes, [{ rowId: 'retry', success: true }]);
});

test('BULK-03: baris kosong diabaikan dan baris sebagian ditandai', async () => {
    let calls = 0;
    const blank = row('blank', {
        subject_id: '', class_id: '', bank_id: '', date: '', session_id: '', room: '',
    });
    const partial = row('partial', { session_id: '' });
    const result = await saveBulkScheduleRows('period-1', [blank, partial], async () => {
        calls += 1;
        return { success: true };
    });

    assert.equal(calls, 0);
    assert.deepEqual(result.blankIds, ['blank']);
    assert.deepEqual(result.incompleteIds, ['partial']);
});

test('BULK-04: duplikat bank dan kelas di dalam batch ditolak sebelum request', async () => {
    let calls = 0;
    const result = await saveBulkScheduleRows('period-1', [
        row('first', { class_id: 'class-same' }),
        row('duplicate', { class_id: 'class-same', date: '2026-09-21' }),
    ], async () => {
        calls += 1;
        return { success: true };
    });

    assert.equal(calls, 1);
    assert.deepEqual(result.duplicateIds, ['duplicate']);

    const retry = await saveBulkScheduleRows('period-1', [
        row('saved', { status: 'saved', class_id: 'class-same' }),
        row('duplicate', { class_id: 'class-same' }),
    ], async () => {
        calls += 1;
        return { success: true };
    });
    assert.equal(calls, 1);
    assert.deepEqual(retry.duplicateIds, ['duplicate']);
});

test('BULK-05: gangguan jaringan pada satu baris tidak menghapus hasil baris lain', async () => {
    const result = await saveBulkScheduleRows('period-1', [row('ok'), row('offline')], async (input) => {
        if (input.class_id === 'class-offline') throw new Error('Jaringan terputus');
        return { success: true };
    });

    assert.deepEqual(result.outcomes, [
        { rowId: 'ok', success: true },
        { rowId: 'offline', success: false, error: 'Jaringan terputus' },
    ]);
});

test('BULK-06: Admin dan Proktor memakai komponen bersama dengan status per baris', () => {
    const shared = fs.readFileSync(
        path.resolve(__dirname, '../../web/app/components/pas/BulkScheduleGrid.tsx'),
        'utf8',
    );
    assert.match(shared, /saveBulkScheduleRows/);
    assert.match(shared, /outcome\.success/);
    assert.match(shared, /Coba Lagi/);
    assert.match(shared, /Tersimpan/);
    assert.doesNotMatch(shared, /alert\(/);

    for (const role of ['admin', 'proktor']) {
        const source = fs.readFileSync(
            path.resolve(__dirname, `../../web/app/dashboard/${role}/exams/pas/[id]/BulkScheduleGrid.tsx`),
            'utf8',
        );
        assert.match(source, /components\/pas\/BulkScheduleGrid/);
    }
});

test('BULK-07: database dan klien mempertahankan pengaman retry dan duplikasi', () => {
    const migration = fs.readFileSync(
        path.resolve(__dirname, '../../../database/migrations/20260927_02_idempotent_child_creates.sql'),
        'utf8',
    );
    const client = fs.readFileSync(
        path.resolve(__dirname, '../../web/lib/api/client.ts'),
        'utf8',
    );
    assert.match(migration, /cbt_pas_class_schedules_client_request_unique/i);
    assert.match(migration, /cbt_pas_schedule_business_unique/i);
    assert.match(client, /stored\?\.fingerprint === fingerprint/);
    assert.match(client, /result\.success \|\| !result\.retryable/);
});

test('BULK-08: subject_id opsional dan duration_minutes dipetakan ke duration_override', async () => {
    const payloads = [];
    const result = await saveBulkScheduleRows('period-1', [
        row('no-subj', { subject_id: '', duration_minutes: 90, room: 'Lab 1' }),
    ], async (input) => {
        payloads.push(input);
        return { success: true };
    });

    assert.equal(result.outcomes.length, 1);
    assert.equal(result.outcomes[0].success, true);
    assert.equal(payloads[0].subject_id, undefined);
    assert.equal(payloads[0].duration_override, 90);
    assert.equal(payloads[0].room, 'Lab 1');
});

test('BULK-09: import Excel/CSV memetakan referensi, memecah multi-kelas, dan menandai referensi yang tidak cocok', () => {
    const catalog = {
        subjects: [{ id: 'sub-mat', name: 'Matematika' }],
        classes: [
            { id: 'cls-10a', name: 'X-A' },
            { id: 'cls-10b', name: 'X-B' },
        ],
        qBanks: [{ id: 'bank-mat', title: 'PAS Matematika Kelas X', subject: 'Matematika' }],
        sessions: [{ id: 'ses-1', name: 'Sesi 1', start_time: '07:30:00', end_time: '09:30:00' }],
    };

    assert.equal(
        resolveBankSubjectId('bank-mat', catalog.qBanks, catalog.subjects),
        'sub-mat',
    );

    let seq = 0;
    const parsed = parseImportedScheduleRows([
        {
            'Bank Soal': 'PAS Matematika Kelas X',
            'Kelas': 'X-A, X-B',
            'Tanggal': '20/12/2026',
            'Sesi Ujian': 'Sesi 1',
            'Durasi (Menit)': '90',
            'Ruangan': 'Ruang 01',
        },
        {
            'Bank Soal': 'Bank Tidak Ada',
            'Kelas': 'X-A',
            'Tanggal': '2026-12-21',
            'Sesi Ujian': 'Sesi 9',
        },
    ], catalog, () => `imp-${++seq}`);

    assert.equal(parsed.length, 3);
    assert.equal(parsed[0].bank_id, 'bank-mat');
    assert.equal(parsed[0].subject_id, 'sub-mat');
    assert.equal(parsed[0].class_id, 'cls-10a');
    assert.equal(parsed[0].date, '2026-12-20');
    assert.equal(parsed[0].session_id, 'ses-1');
    assert.equal(parsed[0].duration_minutes, 90);
    assert.equal(parsed[0].room, 'Ruang 01');
    assert.equal(parsed[0].status, 'idle');

    assert.equal(parsed[1].class_id, 'cls-10b');
    assert.equal(parsed[1].status, 'idle');

    assert.equal(parsed[2].status, 'error');
    assert.match(parsed[2].error, /Bank soal "Bank Tidak Ada" tidak ditemukan/);
    assert.match(parsed[2].error, /Sesi "Sesi 9" tidak ditemukan/);
});

