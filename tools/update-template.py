#!/usr/bin/env python3
"""Update generate-template.js with stimulus/instruction tables and A/B/C for PG/PGK."""
import sys

path = r'c:\Users\imran\.gemini\antigravity\scratch\cbt-app\scripts\generate-template.js'

with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

marker = '// ── Section 1: Petunjuk Penggunaan'
idx = content.find(marker)
if idx == -1:
    print('Marker not found!')
    sys.exit(1)

before = content[:idx]

new_sections = '''// ── Section 1: Petunjuk Penggunaan ──────────────────────────────────────────
const instructionsSection = [
    new Paragraph({ children: [new TextRun({ text: "PETUNJUK PENGGUNAAN TEMPLATE IMPORT", bold: true, size: 24 })], spacing: { after: 200 } }),
    new Paragraph({ children: [new TextRun({ text: "1. KOLOM NO: angka = soal baru. KOSONGKAN untuk semua baris sub-item.", size: 20 })], spacing: { after: 80 } }),
    new Paragraph({ children: [new TextRun({ text: "2. KOLOM TIPE: O1/O2/O3/O4/O5=opsi PG/PGK, P1/P2=pernyataan BS, MJ1/MJ2=sub-item MJ, CAT1/CAT2=sub-item CAT.", size: 20 })], spacing: { after: 80 } }),
    new Paragraph({ children: [new TextRun({ text: "3. KOLOM KUNCI: huruf (PG), B|S (BS), jawaban kanan (MJ), nama kategori (CAT, pisah koma untuk banyak).", size: 20 })], spacing: { after: 80 } }),
    new Paragraph({ children: [new TextRun({ text: "4. KUNCI ISIAN = jawaban singkat. Multi-variasi dipisah koma. Placeholder: ... (tiga titik).", size: 20 })], spacing: { after: 80 } }),
    new Paragraph({ children: [new TextRun({ text: "5. KATEGORISASI: satu item bisa masuk banyak kategori (pisahkan dengan koma, contoh: Mamalia, Vertebrata).", size: 20 })], spacing: { after: 80 } }),
    new Paragraph({ children: [new TextRun({ text: "6. MENJODOHKAN: item kiri tidak harus dipasangkan semua. Item kiri tanpa pasangan = tidak dijawab. Item kanan tanpa pasangan = distraktor.", size: 20 })], spacing: { after: 80 } }),
    new Paragraph({ children: [new TextRun({ text: "7. STIMULUS & PETUNJUK: lihat tabel STIMULUS dan PETUNJUK di atas. Kolom Stimulus/Petunjuk gunakan kode: [S1], [S2], [I1], [I2], dst.", size: 20 })], spacing: { after: 300 } }),
];

// ── Section 2: Legenda Tipe Soal ─────────────────────────────────────────────
const legendRows = [
    hRow([hCell("Kode", 10), hCell("Nama", 20), hCell("Cara Mengisi", 70)]),
    dRow([dCell("PG", 10, "CENTER"), dCell("Pilihan Ganda", 20), dCell("Baris utama: No=angka, Tipe=PG, Soal=pertanyaan. Baris sub: No=A/B/C..., Tipe=O1/O2..., Kunci baris utama = huruf benar.", 70)]),
    dRow([dCell("PGK", 10, "CENTER"), dCell("PG Kompleks", 20), dCell("Sama seperti PG, tapi Kunci = huruf dipisah koma (contoh: A,C).", 70)]),
    dRow([dCell("BS", 10, "CENTER"), dCell("Benar/Salah", 20), dCell("Baris sub: Tipe=P1/P2..., Soal=pernyataan.", 70)]),
    dRow([dCell("MJ", 10, "CENTER"), dCell("Menjodohkan", 20), dCell("Baris sub: Tipe=MJ1/MJ2..., Soal=item kiri, Kunci=item kanan. Item kiri tanpa pasangan = tidak dijawab. Item kanan tanpa pasangan = distraktor.", 70)]),
    dRow([dCell("CAT", 10, "CENTER"), dCell("Kategorisasi", 20), dCell("Baris sub: Tipe=CAT1/CAT2..., Soal=item, Kunci=nama kategori (pisahkan koma untuk banyak).", 70)]),
    dRow([dCell("ISIAN", 10, "CENTER"), dCell("Isian Singkat", 20), dCell("Kunci baris utama = jawaban singkat. Multi-variasi dipisah koma. Placeholder: ...", 70)]),
    dRow([dCell("ESAI", 10, "CENTER"), dCell("Essay/Uraian", 20), dCell("Kunci kosongkan. Skor default tinggi.", 70)]),
];

// ── Section 3: Tabel Stimulus ──────────────────────────────────────────────────
const stimulusRows = [
    hRow([hCell("Kode", 15), hCell("Isi Stimulus", 85)]),
    dRow([dCell("[S1]", 15, "CENTER"), dCell("Perhatikan teks berikut untuk menjawab soal nomor 1-3.", 85)]),
    dRow([dCell("[S2]", 15, "CENTER"), dCell("Bacalah paragraf di bawah ini dengan seksama sebelum menjawab pertanyaan.", 85)]),
];

// ── Section 4: Tabel Petunjuk ─────────────────────────────────────────────────
const instructionRows = [
    hRow([hCell("Kode", 15), hCell("Isi Petunjuk", 85)]),
    dRow([dCell("[I1]", 15, "CENTER"), dCell("Pilihlah satu jawaban yang paling tepat.", 85)]),
    dRow([dCell("[I2]", 15, "CENTER"), dCell("Pilih semua jawaban yang benar (jawaban boleh lebih dari satu).", 85)]),
    dRow([dCell("[I3]", 15, "CENTER"), dCell("Tandai B jika benar dan S jika salah untuk setiap pernyataan.", 85)]),
];

// ── Section 5: Tabel Import Utama ────────────────────────────────────────────
const mainTableRows = [
    hRow([hCell("No", 5), hCell("Tipe", 7), hCell("Stimulus", 9), hCell("Petunjuk", 9), hCell("Soal / Pertanyaan / Opsi", 50), hCell("Kunci", 12), hCell("Poin", 8)]),
    // ── Contoh 1: PG ─────────────────────────────────────────────────────────
    dRow([dCell("1", 5, "CENTER"), dCell("PG", 7, "CENTER"), dCell("[S1]", 9), dCell("[I1]", 9), dCell("Siapakah presiden pertama Republik Indonesia?", 50), dCell("A", 12, "CENTER"), dCell("1", 8, "CENTER")]),
    dRow([dCell("A", 5, "CENTER"), dCell("O1", 7, "CENTER"), dCell("", 9), dCell("", 9), dCell("Soekarno", 50), dCell("", 12), dCell("", 8)]),
    dRow([dCell("B", 5, "CENTER"), dCell("O2", 7, "CENTER"), dCell("", 9), dCell("", 9), dCell("Soeharto", 50), dCell("", 12), dCell("", 8)]),
    dRow([dCell("C", 5, "CENTER"), dCell("O3", 7, "CENTER"), dCell("", 9), dCell("", 9), dCell("Habibie", 50), dCell("", 12), dCell("", 8)]),
    dRow([dCell("D", 5, "CENTER"), dCell("O4", 7, "CENTER"), dCell("", 9), dCell("", 9), dCell("Megawati", 50), dCell("", 12), dCell("", 8)]),
    // ── Contoh 2: PGK ───────────────────────────────────────────────────────
    dRow([dCell("2", 5, "CENTER"), dCell("PGK", 7, "CENTER"), dCell("[S2]", 9), dCell("[I2]", 9), dCell("Manakah yang merupakan planet? (jawaban lebih dari satu)", 50), dCell("A,C", 12, "CENTER"), dCell("2", 8, "CENTER")]),
    dRow([dCell("A", 5, "CENTER"), dCell("O1", 7, "CENTER"), dCell("", 9), dCell("", 9), dCell("Mars", 50), dCell("", 12), dCell("", 8)]),
    dRow([dCell("B", 5, "CENTER"), dCell("O2", 7, "CENTER"), dCell("", 9), dCell("", 9), dCell("Matahari", 50), dCell("", 12), dCell("", 8)]),
    dRow([dCell("C", 5, "CENTER"), dCell("O3", 7, "CENTER"), dCell("", 9), dCell("", 9), dCell("Bumi", 50), dCell("", 12), dCell("", 8)]),
    dRow([dCell("D", 5, "CENTER"), dCell("O4", 7, "CENTER"), dCell("", 9), dCell("", 9), dCell("Bulan", 50), dCell("", 12), dCell("", 8)]),
    // ── Contoh 3: BS ─────────────────────────────────────────────────────────
    dRow([dCell("3", 5, "CENTER"), dCell("BS", 7, "CENTER"), dCell("", 9), dCell("[I3]", 9), dCell("Pilih B (Benar) jika pernyataan benar, atau S (Salah) jika salah.", 50), dCell("B|S", 12, "CENTER"), dCell("2", 8, "CENTER")]),
    dRow([dCell("", 5, "CENTER"), dCell("P1", 7, "CENTER"), dCell("", 9), dCell("", 9), dCell("Air mendidih pada suhu 100C pada tekanan standar.", 50), dCell("", 12), dCell("", 8)]),
    dRow([dCell("", 5, "CENTER"), dCell("P2", 7, "CENTER"), dCell("", 9), dCell("", 9), dCell("Matahari terbit dari arah barat.", 50), dCell("", 12), dCell("", 8)]),
    // ── Contoh 4: MJ ─────────────────────────────────────────────────────────
    dRow([dCell("4", 5, "CENTER"), dCell("MJ", 7, "CENTER"), dCell("", 9), dCell("", 9), dCell("Jodohkan hewan dengan makanannya!", 50), dCell("", 12), dCell("2", 8, "CENTER")]),
    dRow([dCell("", 5, "CENTER"), dCell("MJ1", 7, "CENTER"), dCell("", 9), dCell("", 9), dCell("Kucing", 50), dCell("Ikan", 12), dCell("", 8)]),
    dRow([dCell("", 5, "CENTER"), dCell("MJ2", 7, "CENTER"), dCell("", 9), dCell("", 9), dCell("Kelinci", 50), dCell("Wortel", 12), dCell("", 8)]),
    dRow([dCell("", 5, "CENTER"), dCell("MJ3", 7, "CENTER"), dCell("", 9), dCell("", 9), dCell("Ayam", 50), dCell("Beras", 12), dCell("", 8)]),
    dRow([dCell("", 5, "CENTER"), dCell("MJ4", 7, "CENTER"), dCell("", 9), dCell("", 9), dCell("Distractor", 50), dCell("", 12), dCell("", 8)]),
    // ── Contoh 5: CAT ────────────────────────────────────────────────────────
    dRow([dCell("5", 5, "CENTER"), dCell("CAT", 7, "CENTER"), dCell("", 9), dCell("", 9), dCell("Kelompokkan hewan berikut!", 50), dCell("", 12), dCell("2", 8, "CENTER")]),
    dRow([dCell("", 5, "CENTER"), dCell("CAT1", 7, "CENTER"), dCell("", 9), dCell("", 9), dCell("Kucing", 50), dCell("Mamalia, Vertebrata", 12), dCell("", 8)]),
    dRow([dCell("", 5, "CENTER"), dCell("CAT2", 7, "CENTER"), dCell("", 9), dCell("", 9), dCell("Elang", 50), dCell("Burung, Vertebrata", 12), dCell("", 8)]),
    // ── Contoh 6: ISIAN ──────────────────────────────────────────────────────
    dRow([dCell("6", 5, "CENTER"), dCell("ISIAN", 7, "CENTER"), dCell("", 9), dCell("", 9), dCell("Ibu kota Indonesia adalah ... , sedangkan ibu kota Jepang adalah ....", 50), dCell("Jakarta, jakarta | Tokyo, tokyo", 12, "CENTER"), dCell("2", 8, "CENTER")]),
    // ── Contoh 7: ESAI ───────────────────────────────────────────────────────
    dRow([dCell("7", 5, "CENTER"), dCell("ESAI", 7, "CENTER"), dCell("", 9), dCell("", 9), dCell("Jelaskan proses terjadinya hujan! Berikan minimal 3 tahap.", 50), dCell("", 12), dCell("5", 8, "CENTER")]),
];
'''

with open(path, 'w', encoding='utf-8') as f:
    f.write(before + new_sections)

print('Done!')