const fs = require('fs');
let c = fs.readFileSync('scripts/generate-template.js', 'utf8');

// ── Fix: Kucing row (CAT1) ───────────────────────────────────────────────────
c = c.replace(
    'dRow([dCell("1", 5, "CENTER"), dCell("", 7), dCell("", 9), dCell("", 9), dCell("Kucing", 50), dCell("Mamalia", 12), dCell("", 8)])',
    'dRow([dCell("", 5, "CENTER"), dCell("CAT1", 7, "CENTER"), dCell("", 9), dCell("", 9), dCell("Kucing", 50), dCell("Mamalia", 12), dCell("", 8)])'
);

// ── Fix: Elang row (CAT2) ─────────────────────────────────────────────────────
c = c.replace(
    'dRow([dCell("2", 5, "CENTER"), dCell("", 7), dCell("", 9), dCell("", 9), dCell("Elang", 50), dCell("Burung", 12), dCell("", 8)])',
    'dRow([dCell("", 5, "CENTER"), dCell("CAT2", 7, "CENTER"), dCell("", 9), dCell("", 9), dCell("Elang", 50), dCell("Burung", 12), dCell("", 8)])'
);

// ── Fix: Indonesia row (MJ1) ─────────────────────────────────────────────────
c = c.replace(
    'dRow([dCell("1", 5, "CENTER"), dCell("", 7), dCell("", 9), dCell("", 9), dCell("Indonesia", 50), dCell("Jakarta", 12), dCell("", 8)])',
    'dRow([dCell("", 5, "CENTER"), dCell("MJ1", 7, "CENTER"), dCell("", 9), dCell("", 9), dCell("Indonesia", 50), dCell("Jakarta", 12), dCell("", 8)])'
);

// ── Fix: Jepang row (MJ2) ──────────────────────────────────────────────────────
c = c.replace(
    'dRow([dCell("2", 5, "CENTER"), dCell("", 7), dCell("", 9), dCell("", 9), dCell("Jepang", 50), dCell("Tokyo", 12), dCell("", 8)])',
    'dRow([dCell("", 5, "CENTER"), dCell("MJ2", 7, "CENTER"), dCell("", 9), dCell("", 9), dCell("Jepang", 50), dCell("Tokyo", 12), dCell("", 8)])'
);

// ── Fix: MJ baris utama — kosongkan kunci (jawaban kanan dari sub-baris) ───────
c = c.replace(
    'dRow([dCell("4", 5, "CENTER"), dCell("MJ", 7, "CENTER"), dCell("", 9), dCell("", 9), dCell("Jodohkan negara berikut dengan ibu kotanya!", 50), dCell("Jakarta | Tokyo", 12, "CENTER"), dCell("2", 8, "CENTER")])',
    'dRow([dCell("4", 5, "CENTER"), dCell("MJ", 7, "CENTER"), dCell("", 9), dCell("", 9), dCell("Jodohkan negara berikut dengan ibu kotanya!", 50), dCell("", 12), dCell("2", 8, "CENTER")])'
);

// ── Fix: CAT baris utama — kosongkan kunci (kategori dari sub-baris) ───────────
c = c.replace(
    'dRow([dCell("5", 5, "CENTER"), dCell("CAT", 7, "CENTER"), dCell("", 9), dCell("", 9), dCell("Kelompokkan hewan berikut berdasarkan kategorinya!", 50), dCell("Mamalia | Burung", 12, "CENTER"), dCell("2", 8, "CENTER")])',
    'dRow([dCell("5", 5, "CENTER"), dCell("CAT", 7, "CENTER"), dCell("", 9), dCell("", 9), dCell("Kelompokkan hewan berikut berdasarkan kategorinya!", 50), dCell("", 12), dCell("2", 8, "CENTER")])'
);

fs.writeFileSync('scripts/generate-template.js', c);
console.log('Done - Semua MJ/CAT sub rows dan kunci utama sudah diperbarui');