const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'CommonJS', moduleResolution: 'Node' } });
require('tsconfig-paths').register({ baseUrl: path.resolve(__dirname, '../../web'), paths: { '@/*': ['./*'] } });

const { drawPdfKop } = require('../../web/lib/pas/pdf-kop.ts');
const { formatKopParts, renderKopHTML } = require('../../web/lib/pas/print-kop.ts');
const { fitLogo } = require('../../web/lib/school-logo.ts');

const profile = {
    nama: 'MAN Insan Cendekia Gowa', jenjang: 'MA', kabupaten_kota: 'Gowa',
    alamat: 'Jl. Insan Cendekia No. 1 yang sangat panjang sekali untuk menguji pembungkusan baris alamat',
    kecamatan: 'Bontomarannu', provinsi: 'Sulawesi Selatan', telepon: '0411-000', email: 'man@example.sch.id',
    logo_url: 'https://sekolah.example/logo.png',
};

/** jsPDF palsu: ukuran teks ±1,9 mm per karakter per 10 pt. */
function fakePdf() {
    const calls = { text: [], images: [], lines: [] };
    let size = 10;
    return {
        calls,
        setFont() {}, setTextColor() {}, setDrawColor() {}, setLineWidth() {},
        setFontSize(value) { size = value; },
        splitTextToSize(text, width) {
            const perLine = Math.max(1, Math.floor(width / (size * 0.19)));
            const words = String(text).split(' '); const lines = []; let line = '';
            for (const word of words) {
                if (line && `${line} ${word}`.length > perLine) { lines.push(line); line = word; } else line = line ? `${line} ${word}` : word;
            }
            if (line) lines.push(line);
            return lines;
        },
        text(text, x, y, options) { calls.text.push({ text, x, y, size, width: String(text).length * size * 0.19, options }); },
        addImage(data, format, x, y, w, h) { calls.images.push({ data, format, x, y, w, h }); },
        line(x1, y1, x2, y2) { calls.lines.push({ x1, y1, x2, y2 }); },
    };
}

test('KOP-01: logo menjaga rasio aslinya dan berada di tengah kotaknya', () => {
    assert.deepEqual(fitLogo({ width: 600, height: 300 }, 22, 22), { width: 22, height: 11 });
    assert.deepEqual(fitLogo({ width: 300, height: 600 }, 22, 22), { width: 11, height: 22 });

    const pdf = fakePdf();
    const kop = formatKopParts(profile);
    const bottom = drawPdfKop(pdf, kop, { dataUrl: 'data:image/png;base64,AAAA', width: 400, height: 600 }, { left: 20, right: 190, top: 10, logoSize: 22 });
    const [image] = pdf.calls.images;
    assert.equal(image.format, 'PNG');
    assert.ok(Math.abs(image.w / image.h - 400 / 600) < 1e-9, 'rasio logo tidak berubah');
    assert.ok(Math.abs(image.x + image.w / 2 - (20 + 11)) < 1e-9, 'logo di tengah kotak horizontal');
    assert.ok(image.y >= 10 && image.y + image.h <= bottom, 'logo berada di atas garis kop');
});

test('KOP-02: teks kop simetris di tengah halaman dan tidak menabrak logo', () => {
    const pdf = fakePdf();
    drawPdfKop(pdf, formatKopParts(profile), { dataUrl: 'data:image/png;base64,AAAA', width: 600, height: 600 }, { left: 20, right: 190, top: 10, logoSize: 22 });
    const texts = pdf.calls.text;
    assert.deepEqual(texts.slice(0, 3).map(t => t.text), [
        'KEMENTERIAN AGAMA REPUBLIK INDONESIA', 'KANTOR KEMENTERIAN AGAMA KABUPATEN GOWA', 'MAN INSAN CENDEKIA GOWA',
    ]);
    assert.ok(texts.every(t => t.x === 105 && t.options.align === 'center'));
    assert.ok(texts.length > 5, 'alamat panjang dibungkus menjadi beberapa baris');
    for (const t of texts) assert.ok(105 - t.width / 2 >= 20 + 22, `"${t.text}" tidak menabrak logo`);
    const ys = texts.map(t => t.y);
    assert.deepEqual(ys, [...ys].sort((a, b) => a - b), 'baris tersusun dari atas ke bawah');
});

test('KOP-03: garis ganda kop selebar area cetak; tanpa logo kop tetap lengkap', () => {
    const pdf = fakePdf();
    const bottom = drawPdfKop(pdf, formatKopParts({ ...profile, logo_url: '' }), null, { left: 12, right: 285, top: 8 });
    assert.equal(pdf.calls.images.length, 0);
    assert.equal(pdf.calls.lines.length, 2);
    assert.ok(pdf.calls.lines.every(line => line.x1 === 12 && line.x2 === 285));
    assert.equal(bottom, pdf.calls.lines[1].y1);
    assert.ok(pdf.calls.text.at(-1).y < pdf.calls.lines[0].y1);
});

test('KOP-04: kop HTML memakai logo data URL tanpa crossorigin dan kolom simetris', () => {
    const html = renderKopHTML(profile, { logoSrc: 'data:image/png;base64,AAAA' });
    assert.match(html, /<img src="data:image\/png;base64,AAAA" class="kop-logo"/);
    assert.doesNotMatch(html, /crossorigin/);
    assert.equal((html.match(/class="kop-logo-cell"/g) || []).length, 2);
    assert.match(renderKopHTML(profile), /src="https:\/\/sekolah\.example\/logo\.png"/);
    assert.doesNotMatch(renderKopHTML({ ...profile, logo_url: '' }), /<img/);
});

test('KOP-05: semua dokumen ujian memakai satu kop berlogo yang sama', () => {
    const web = file => fs.readFileSync(path.resolve(__dirname, '../../web', file), 'utf8');
    for (const file of ['lib/pas/administration-schedule-pdf.ts', 'lib/pas/room-participants-pdf.ts']) {
        const source = web(file);
        assert.match(source, /loadKopLogo\(kop\.logoUrl\)/, file);
        assert.match(source, /drawPdfKop\(pdf, kop, logo,/, file);
        assert.doesNotMatch(source, /mode: 'cors'/, file);
    }
    const panel = web('app/components/pas/PASAdministrationPanel.tsx');
    assert.match(panel, /drawPdfKop\(pdf, kParts, kopLogo,/);
    assert.match(panel, /renderKopHTML\(kopProfile, \{\s*logoSrc:/);
    assert.match(panel, /useKopLogo\(kopParts\.logoUrl\)/);
    assert.doesNotMatch(panel, /mode: 'cors'/);
    assert.match(web('app/components/validations/ValidationReportModal.tsx'), /useKopLogo\(schoolProfile\?\.logo_url\)/);
});
