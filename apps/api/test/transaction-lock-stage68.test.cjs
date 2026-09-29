// Run from repository root: node apps/api/test/transaction-lock-stage68.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('ts-node').register({
    project: path.resolve(__dirname, '../tsconfig.json'),
    transpileOnly: true,
});

const { advisoryTransactionLock } = require('../src/common/transaction-lock.ts');

test('LOCK-01: hasil advisory lock dicast dari void sebelum dibaca Prisma', async () => {
    const calls = [];
    const db = {
        raw: async (...args) => {
            calls.push(args);
            return [{ locked: '' }];
        },
    };

    await advisoryTransactionLock(db, 'exam:user');

    assert.equal(calls.length, 1);
    assert.match(calls[0][0], /pg_advisory_xact_lock/i);
    assert.match(calls[0][0], /\)::text AS locked/i);
    assert.deepEqual(calls[0].slice(1), ['exam:user']);
});

test('LOCK-02: semua advisory lock aplikasi melewati helper yang aman untuk Prisma', () => {
    const sourceRoot = path.resolve(__dirname, '../src');
    const files = [];
    const visit = (directory) => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const absolute = path.join(directory, entry.name);
            if (entry.isDirectory()) visit(absolute);
            else if (entry.name.endsWith('.ts')) files.push(absolute);
        }
    };
    visit(sourceRoot);

    const directUsers = files.filter((file) => {
        if (file.endsWith(path.join('common', 'transaction-lock.ts'))) return false;
        return fs.readFileSync(file, 'utf8').includes('pg_advisory_xact_lock');
    });

    assert.deepEqual(directUsers, []);
});

test('LOCK-03: kegagalan teknis tidak selalu dilabeli sebagai penolakan izin', () => {
    const examPage = fs.readFileSync(
        path.resolve(__dirname, '../../web/app/components/questions/ExamPage.tsx'),
        'utf8',
    );

    assert.match(examPage, /Ujian Belum Dapat Dibuka/);
    assert.doesNotMatch(examPage, /\? 'Ujian Telah Selesai' : 'Akses Ditolak'/);
});
