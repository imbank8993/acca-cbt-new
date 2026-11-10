// Run from repository root: node --test apps/api/test/storage-cleanup-stage114.test.cjs
// "Bersihkan gambar tak terpakai": hanya gambar soal yang benar-benar yatim yang dihapus.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const JSZip = require('jszip');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { load } = require('../../../tools/question-test-loader.cjs');
const cleanup = require('../src/storage/unused-images.service.ts');
const { UnusedImagesService, questionImageName, referencedNamesSql, normalizeAge } = cleanup;

const root = path.resolve(__dirname, '../../..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const NOW = new Date('2026-11-10T00:00:00Z');
const OLD = new Date('2026-08-01T00:00:00Z');
const NEW = new Date('2026-11-05T00:00:00Z');

function harness({ objects, references, failTable = null }) {
    const queries = [];
    const db = {
        async raw(sql, ...params) {
            queries.push({ sql, params });
            if (sql.includes('information_schema.columns')) {
                return [
                    { table_schema: 'public', table_name: 'cbt_bank_questions', column_name: 'question_text' },
                    { table_schema: 'public', table_name: 'cbt_bank_questions', column_name: 'metadata' },
                    { table_schema: 'public', table_name: 'cbt_learning_materials', column_name: 'content_html' },
                ];
            }
            const table = /FROM "public"\."([^"]+)"/.exec(sql)[1];
            if (table === failTable) throw new Error('timeout');
            return (references[table] || []).map(name => ({ name }));
        },
    };
    const deleted = [];
    const listed = [];
    const storage = {
        isConfigured: () => true,
        async listPrefixes(prefix) {
            const children = objects.filter(o => o.key.startsWith(prefix))
                .map(o => prefix + o.key.slice(prefix.length).split('/')[0] + '/');
            return [...new Set(children)];
        },
        async listObjects(prefix) {
            listed.push(prefix);
            return { objects: objects.filter(o => o.key.startsWith(prefix)), truncated: false };
        },
        async deleteObjects(keys) {
            deleted.push(...keys);
            return { deleted: keys, failed: [] };
        },
    };
    return { service: new UnusedImagesService(db, storage), queries, deleted, listed };
}

const OBJECTS = [
    { key: 'users/u1/questions/1700000000000_aaaa0001.png', size: 500, lastModified: OLD },   // dipakai soal
    { key: 'users/u1/questions/1700000000000_aaaa0002.webp', size: 900, lastModified: OLD },  // yatim
    { key: 'users/u1/questions/1700000000000_aaaa0003.jpg', size: 300, lastModified: NEW },   // yatim tapi baru
    { key: 'users/u2/banks/1700000000000_bbbb0001.webp', size: 700, lastModified: OLD },      // sampul yatim
    { key: 'banks/b1/equations/eq_abc.svg', size: 100, lastModified: OLD },                    // dipakai materi
    { key: 'users/u1/avatars/1700000000000_cccc0001.png', size: 999, lastModified: OLD },     // bukan gambar soal
    { key: 'users/u1/questions-audio/1700000000000_dddd0001.mp3', size: 999, lastModified: OLD },
    { key: 'users/u1/questions/1700000000000_eeee0001.pdf', size: 999, lastModified: OLD },
    { key: 'assignments/e1/s1/1700000000000_ffff0001.png', size: 999, lastModified: OLD },
    { key: 'users/u3/questions/Gambar%20Lama.png', size: 50, lastModified: OLD },             // dipakai, nama ter-encode
    { key: 'ptsp/berkas/1700000000000_9999aaaa.png', size: 999, lastModified: OLD },          // milik aplikasi lain
    { key: 'users/u1/ptsp/1700000000000_9999bbbb.png', size: 999, lastModified: OLD },        // subfolder lain
];
const REFERENCES = {
    cbt_bank_questions: ['1700000000000_aaaa0001.png', 'gambar%20lama.png'],
    cbt_learning_materials: ['eq_abc.svg'],
};

test('CLEAN-01: hanya gambar dari folder gambar soal yang menjadi kandidat', () => {
    assert.equal(questionImageName('users/u1/questions/1_a.PNG'), '1_a.png');
    assert.equal(questionImageName('users/u1/banks/1_a.webp'), '1_a.webp');
    assert.equal(questionImageName('banks/b1/equations/eq_x.svg'), 'eq_x.svg');
    for (const key of ['users/u1/avatars/a.png', 'users/u1/logos/a.png', 'assignments/e/s/a.png', 'exam-evidence/a.png',
        'questions/legacy.png', 'users/u1/questions-audio/a.mp3', 'users/u1/questions/a.pdf', 'lms-private/a.png', 'users/u1/misc/a.png']) {
        assert.equal(questionImageName(key), null, key);
    }
});

test('CLEAN-02: SQL memindai semua kolom teks satu tabel dengan identifier yang di-quote', () => {
    const sql = referencedNamesSql('public', 'we"ird', ['a', 'b"c']);
    assert.match(sql, /FROM "public"\."we""ird" AS src/);
    assert.match(sql, /concat_ws\(' ', src\."a"::text, src\."b""c"::text\)/);
    assert.match(sql, /regexp_matches\(.*'gi'\)/);
    assert.match(sql, /png\|jpe\?g\|gif\|webp\|bmp\|svg/);
});

test('CLEAN-03: pratinjau memisahkan gambar terpakai, baru, dan yatim; berkas lain tidak disentuh', async () => {
    const { service, queries } = harness({ objects: OBJECTS, references: REFERENCES });
    const preview = await service.preview(30);
    assert.equal(preview.imageObjects, 6);
    assert.equal(preview.referencedCount, 3);
    assert.equal(preview.recentCount, 1);
    assert.deepEqual(preview.items.map(item => item.key), [
        'users/u1/questions/1700000000000_aaaa0002.webp',
        'users/u2/banks/1700000000000_bbbb0001.webp',
    ]);
    assert.equal(preview.unusedBytes, 1600);
    assert.equal(preview.scannedTables, 2);
    assert.deepEqual(queries[0].params[0].includes('jsonb'), true, 'kolom JSON ikut dipindai');
});

test('CLEAN-03b: hanya folder gambar soal yang didaftar; folder aplikasi lain tidak dibuka', async () => {
    const { service, listed } = harness({ objects: OBJECTS, references: REFERENCES });
    await service.preview();
    assert.deepEqual([...listed].sort(), [
        'banks/b1/equations/',
        'users/u1/banks/', 'users/u1/questions/',
        'users/u2/banks/', 'users/u2/questions/',
        'users/u3/banks/', 'users/u3/questions/',
    ]);
    assert.ok(listed.every(prefix => /^(users\/[^/]+\/(questions|banks)|banks\/[^/]+\/equations)\/$/.test(prefix)));
});

test('CLEAN-04: penghapusan memindai ulang dan hanya menghapus kunci yang masih yatim', async () => {
    const references = { ...REFERENCES, cbt_bank_questions: [...REFERENCES.cbt_bank_questions] };
    const { service, deleted } = harness({ objects: OBJECTS, references });
    const preview = await service.preview();
    // Sesudah pratinjau, salah satu gambar dipakai lagi oleh soal baru.
    references.cbt_bank_questions.push('1700000000000_bbbb0001.webp');
    const result = await service.cleanup('admin', [
        ...preview.items.map(item => item.key),
        'users/u1/avatars/1700000000000_cccc0001.png',  // disisipkan klien: bukan gambar soal
        'users/u1/questions/1700000000000_aaaa0001.png', // dipakai
    ]);
    assert.deepEqual(deleted, ['users/u1/questions/1700000000000_aaaa0002.webp']);
    assert.equal(result.deleted, 1);
    assert.equal(result.skipped, 3);
    assert.equal(result.freedBytes, 900);
});

test('CLEAN-05: satu tabel gagal dipindai → tidak ada yang dihapus', async () => {
    const { service, deleted } = harness({ objects: OBJECTS, references: REFERENCES, failTable: 'cbt_learning_materials' });
    await assert.rejects(service.cleanup('admin', ['users/u1/questions/1700000000000_aaaa0002.webp']), /dibatalkan/);
    assert.deepEqual(deleted, []);
});

test('CLEAN-06: umur minimum dan pemindaian ganda dijaga', async () => {
    assert.equal(normalizeAge(undefined), 30);
    assert.throws(() => normalizeAge(3), /paling sedikit 7/);
    const { service } = harness({ objects: OBJECTS, references: REFERENCES });
    const first = service.preview();
    await assert.rejects(service.preview(), /sedang berjalan/);
    await first;
    await service.preview();
});

test('CLEAN-07: endpoint hanya untuk Admin dan tampil di halaman Backup Data', () => {
    const controller = read('apps/api/src/storage/storage-cleanup.controller.ts');
    assert.match(controller, /@UseGuards\(JwtAuthGuard, RolesGuard\)\s*@Roles\('ADMIN'\)/);
    assert.match(read('apps/api/src/storage/storage.module.ts'), /StorageCleanupController/);
    assert.match(read('apps/web/app/dashboard/admin/backup/page.tsx'), /<UnusedImagesCleanupCard \/>/);
    assert.match(read('apps/web/app/api/storage/cleanup/unused-images/delete/route.ts'), /proxyJson\(request, '\/storage\/cleanup\/unused-images\/delete'/);
});

test('CLEAN-08: impor ulang file ekspor lama memakai gambar dari dokumen bila berkasnya sudah dibersihkan', async () => {
    const exp = load('apps/web/lib/export-template.ts');
    const archive = load('apps/web/lib/question-archive.ts');
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108020000009077' +
        '53de0000000c4944415408d763f8ffff3f0005fe02fea7d6a4480000000049454e44ae426082', 'hex');
    const url = '/api/storage/file/users/u1/questions/1700000000000_aaaa0002.png';
    const images = new Map([[url, { data: new Uint8Array(png), type: 'png', width: 1, height: 1 }]]);
    const q = { id: 'q', type: 'essay', question_text: `<p>Gambar:</p><p><img src="${url}"></p>`, bank_question_options: [] };
    const blob = await exp.buildAkademikDoc([q], { title: 'Audit' }, [], [], [], { images });
    const buffer = Buffer.from(await blob.arrayBuffer());
    const stored = JSON.parse(await (await JSZip.loadAsync(buffer)).file('cbt/questions.json').async('string'));
    assert.match(Object.values(stored.media)[0], /^word\/media\//);

    const kept = await archive.readQuestionArchive(buffer, { isAvailable: async () => true });
    assert.match(kept[0].question_text, new RegExp(url.replace(/[/.]/g, '\\$&')));
    const restored = await archive.readQuestionArchive(buffer, { isAvailable: async () => false });
    assert.doesNotMatch(restored[0].question_text, /\/api\/storage\/file\//);
    assert.match(restored[0].question_text, new RegExp(`data:image/png;base64,${png.toString('base64').slice(0, 20).replace(/[+/]/g, '\\$&')}`));
});
