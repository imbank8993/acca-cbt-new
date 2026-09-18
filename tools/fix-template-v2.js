/**
 * fix-template-v2.js
 * Perbaiki generate-template.js agar menggunakan format baru:
 * - PG/PGK: Opsi di Tipe=O1/O2/O3/O4/O5
 * - MJ: No=kosong, Tipe=MJ1/MJ2, Kunci=jawaban kanan
 * - CAT: No=kosong, Tipe=CAT1/CAT2, Kunci=kategori
 * - BS: No=kosong, Tipe=P1/P2
 */
const fs = require('fs');
let c = fs.readFileSync('scripts/generate-template.js', 'utf8');

// ── Fix PG baris sub: No=kosong, Tipe=O1/O2/O3/O4 ──────────────────────────
c = c.replace(
    'dRow([dCell("A", 5, "CENTER"), dCell("", 7), dCell("", 9), dCell("", 9), dCell("Soekarno", 50)',
    'dRow([dCell("", 5, "CENTER"), dCell("O1", 7, "CENTER"), dCell("", 9), dCell("", 9), dCell("Soekarno", 50)'
);
c = c.replace(
    'dRow([dCell("B", 5, "CENTER"), dCell("", 7), dCell("", 9), dCell("", 9), dCell("Soeharto", 50)',
    'dRow([dCell("", 5, "CENTER"), dCell("O2", 7, "CENTER"), dCell("", 9), dCell("", 9), dCell("Soeharto", 50)'
);
c = c.replace(
    'dRow([dCell("C", 5, "CENTER"), dCell("", 7), dCell("", 9), dCell("", 9), dCell("Habibie", 50)',
    'dRow([dCell("", 5, "CENTER"), dCell("O3", 7, "CENTER"), dCell("", 9), dCell("", 9), dCell("Habibie", 50)'
);
c = c.replace(
    'dRow([dCell("D", 5, "CENTER"), dCell("", 7), dCell("", 9), dCell("", 9), dCell("Megawati", 50)',
    'dRow([dCell("", 5, "CENTER"), dCell("O4", 7, "CENTER"), dCell("", 9), dCell("", 9), dCell("Megawati", 50)'
);

// ── Fix PGK baris sub: No=kosong, Tipe=O1/O2/O3/O4 ────────────────────────
c = c.replace(
    'dRow([dCell("A", 5, "CENTER"), dCell("", 7), dCell("", 9), dCell("", 9), dCell("Mars", 50)',
    'dRow([dCell("", 5, "CENTER"), dCell("O1", 7, "CENTER"), dCell("", 9), dCell("", 9), dCell("Mars", 50)'
);
c = c.replace(
    'dRow([dCell("B", 5, "CENTER"), dCell("", 7), dCell("", 9), dCell("", 9), dCell("Matahari", 50)',
    'dRow([dCell("", 5, "CENTER"), dCell("O2", 7, "CENTER"), dCell("", 9), dCell("", 9), dCell("Matahari", 50)'
);
c = c.replace(
    'dRow([dCell("C", 5, "CENTER"), dCell("", 7), dCell("", 9), dCell("", 9), dCell("Bumi", 50)',
    'dRow([dCell("", 5, "CENTER"), dCell("O3", 7, "CENTER"), dCell("", 9), dCell("", 9), dCell("Bumi", 50)'
);
c = c.replace(
    'dRow([dCell("D", 5, "CENTER"), dCell("", 7), dCell("", 9), dCell("", 9), dCell("Bulan", 50)',
    'dRow([dCell("", 5, "CENTER"), dCell("O4", 7, "CENTER"), dCell("", 9), dCell("", 9), dCell("Bulan", 50)'
);

// ── Fix BS: sudah P1/P2, tapi No masih '1'/'2' ──────────────────────────
// Cari P1 baris dan ganti No di sebelah kirinya
c = c.replace(
    'dRow([dCell("1", 5, "CENTER"), dCell("P1", 7, "CENTER"), dCell("", 9), dCell("", 9), dCell("Air mendidih',
    'dRow([dCell("", 5, "CENTER"), dCell("P1", 7, "CENTER"), dCell("", 9), dCell("", 9), dCell("Air mendidih'
);
c = c.replace(
    'dRow([dCell("2", 5, "CENTER"), dCell("P2", 7, "CENTER"), dCell("", 9), dCell("", 9), dCell("Matahari terbit',
    'dRow([dCell("", 5, "CENTER"), dCell("P2", 7, "CENTER"), dCell("", 9), dCell("", 9), dCell("Matahari terbit'
);

// ── Fix MJ: sudah MJ1/MJ2 tapi No masih '1'/'2' ────────────────────────
c = c.replace(
    'dRow([dCell("1", 5, "CENTER"), dCell("MJ1", 7, "CENTER"), dCell("", 9), dCell("", 9), dCell("Indonesia"',
    'dRow([dCell("", 5, "CENTER"), dCell("MJ1", 7, "CENTER"), dCell("", 9), dCell("", 9), dCell("Indonesia"'
);
c = c.replace(
    'dRow([dCell("2", 5, "CENTER"), dCell("MJ2", 7, "CENTER"), dCell("", 9), dCell("", 9), dCell("Jepang"',
    'dRow([dCell("", 5, "CENTER"), dCell("MJ2", 7, "CENTER"), dCell("", 9), dCell("", 9), dCell("Jepang"'
);

// ── Fix CAT: sudah CAT1/CAT2 tapi No masih '1'/'2' ────────────────────
c = c.replace(
    'dRow([dCell("1", 5, "CENTER"), dCell("CAT1", 7, "CENTER"), dCell("", 9), dCell("", 9), dCell("Kucing"',
    'dRow([dCell("", 5, "CENTER"), dCell("CAT1", 7, "CENTER"), dCell("", 9), dCell("", 9), dCell("Kucing"'
);
c = c.replace(
    'dRow([dCell("2", 5, "CENTER"), dCell("CAT2", 7, "CENTER"), dCell("", 9), dCell("", 9), dCell("Elang"',
    'dRow([dCell("", 5, "CENTER"), dCell("CAT2", 7, "CENTER"), dCell("", 9), dCell("", 9), dCell("Elang"'
);

fs.writeFileSync('scripts/generate-template.js', c);
console.log('Done!');
