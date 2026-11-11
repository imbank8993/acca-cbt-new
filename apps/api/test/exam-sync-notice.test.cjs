const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const page = fs.readFileSync(path.resolve(__dirname, '../../web/app/components/questions/ExamPage.tsx'), 'utf8');

test('jawaban yang sekadar menunggu sinkronisasi tidak memunculkan pemberitahuan di layar ujian', () => {
    assert.doesNotMatch(page, /jawaban menunggu sinkronisasi/);
    // Keadaan yang perlu tindakan siswa tetap ditampilkan.
    assert.match(page, /jawaban ditolak server/);
    assert.match(page, /Sesi login berakhir/);
    assert.match(page, /networkLabel\s*\?/);
    assert.match(page, /Penyimpanan perangkat perlu diperiksa/);
});
