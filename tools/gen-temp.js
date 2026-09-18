const {
    Document, Packer, Paragraph, Table, TableRow, TableCell,
    WidthType, BorderStyle, TextRun, AlignmentType, VerticalAlign
} = require("docx");
const fs = require("fs");
const path = require("path");

const BB = { style: BorderStyle.SINGLE, size: 1, color: "000000" };

const hCell = (t, w) => new TableCell({
    children: [new Paragraph({ children: [new TextRun({ text: t, bold: true, size: 20 })], alignment: AlignmentType.CENTER })],
    width: { size: w, type: WidthType.PERCENTAGE },
    shading: { fill: "D9D9D9", type: "clear", color: "auto" },
    borders: { top: BB, bottom: BB, left: BB, right: BB },
    verticalAlign: VerticalAlign.CENTER,
});

const dCell = (t, w, a = "LEFT") => new TableCell({
    children: [new Paragraph({ children: [new TextRun({ text: t, size: 20 })], alignment: a === "CENTER" ? AlignmentType.CENTER : AlignmentType.LEFT })],
    width: { size: w, type: WidthType.PERCENTAGE },
    shading: { fill: "FFFFFF", type: "clear", color: "auto" },
    borders: { top: BB, bottom: BB, left: BB, right: BB },
    verticalAlign: VerticalAlign.TOP,
});

const hRow = c => new TableRow({ tableHeader: true, children: c });
const dRow = c => new TableRow({ children: c });
const sp = (n = 200) => new Paragraph({ children: [], spacing: { after: n } });

const instr = [
    new Paragraph({ children: [new TextRun({ text: "PETUNJUK PENGGUNAAN TEMPLATE IMPORT", bold: true, size: 24 })], spacing: { after: 200 } }),
    new Paragraph({ children: [new TextRun({ text: "1. KOLOM NO: angka = soal baru. KOSONGKAN untuk baris sub-item.", size: 20 })], spacing: { after: 80 } }),
    new Paragraph({ children: [new TextRun({ text: "2. KOLOM TIPE: O1/O2...=opsi PG/PGK, P1/P2...=pernyataan BS, MJ1/MJ2...=sub-item MJ, CAT1/CAT2...=sub-item CAT.", size: 20 })], spacing: { after: 80 } }),
    new Paragraph({ children: [new TextRun({ text: "3. KOLOM KUNCI: huruf (PG), B|S (BS), jawaban kanan (MJ), nama kategori (CAT).", size: 20 })], spacing: { after: 80 } }),
    new Paragraph({ children: [new TextRun({ text: "4. KUNCI ISIAN = jawaban singkat. Multi-variasi dipisah koma. Placeholder: ...", size: 20 })], spacing: { after: 80 } }),
    new Paragraph({ children: [new TextRun({ text: "5. KATEGORISASI: satu item bisa masuk banyak kategori (pisahkan koma).", size: 20 })], spacing: { after: 80 } }),
    new Paragraph({ children: [new TextRun({ text: "6. MENJODOHKAN: item kiri tanpa pasangan = tidak dijawab. Item kanan tanpa pasangan = distraktor.", size: 20 })], spacing: { after: 300 } }),
];

const legendRows = [
    hRow([hCell("Kode", 10), hCell("Nama", 20), hCell("Cara Mengisi", 70)]),
    dRow([dCell("PG", 10, "CENTER"), dCell("Pilihan Ganda", 20), dCell("Baris utama: No=angka, Tipe=PG, Soal=pertanyaan. Baris sub: Tipe=A/B/C/D.", 70)]),
    dRow([dCell("PGK", 10, "CENTER"), dCell("PG Kompleks", 20), dCell("Sama seperti PG, tapi Kunci = huruf dipisah koma (contoh: A,C).", 70)]),
    dRow([dCell("BS", 10, "CENTER"), dCell("Benar/Salah", 20), dCell("Baris sub: Tipe=P1/P2..., Soal=pernyataan.", 70)]),
    dRow([dCell("MJ", 10, "CENTER"), dCell("Menjodohkan", 20), dCell("Baris sub: Tipe=MJ1/MJ2..., Soal=item kiri, Kunci=item kanan.", 70)]),
    dRow([dCell("CAT", 10, "CENTER"), dCell("Kategorisasi", 20), dCell("Baris sub: Tipe=CAT1/CAT2..., Soal=item, Kunci=nama kategori.", 70)]),
    dRow([dCell("ISIAN", 10, "CENTER"), dCell("Isian Singkat", 20), dCell("Kunci baris utama = jawaban singkat. Multi-variasi dipisah koma.", 70)]),
    dRow([dCell("ESAI", 10, "CENTER"), dCell("Essay/Uraian", 20), dCell("Kunci kosongkan. Skor default tinggi.", 70)]),
];

const mainRows = [
    hRow([hCell("No", 5), hCell("Tipe", 6), hCell("Soal / Pertanyaan / Opsi", 69), hCell("Kunci", 12), hCell("Poin", 8)]),
    dRow([dCell("1", 5, "CENTER"), dCell("PG", 6, "CENTER"), dCell("Siapakah presiden pertama Republik Indonesia?", 69), dCell("A", 12, "CENTER"), dCell("1", 8, "CENTER")]),
    dRow([dCell("", 5, "CENTER"), dCell("A", 6, "CENTER"), dCell("Soekarno", 69), dCell("", 12), dCell("", 8)]),
    dRow([dCell("", 5, "CENTER"), dCell("B", 6, "CENTER"), dCell("Soeharto", 69), dCell("", 12), dCell("", 8)]),
    dRow([dCell("", 5, "CENTER"), dCell("C", 6, "CENTER"), dCell("Habibie", 69), dCell("", 12), dCell("", 8)]),
    dRow([dCell("", 5, "CENTER"), dCell("D", 6, "CENTER"), dCell("Megawati", 69), dCell("", 12), dCell("", 8)]),
    dRow([dCell("2", 5, "CENTER"), dCell("PGK", 6, "CENTER"), dCell("Manakah yang merupakan planet? (jawaban lebih dari satu)", 69), dCell("A,C", 12, "CENTER"), dCell("2", 8, "CENTER")]),
    dRow([dCell("", 5, "CENTER"), dCell("A", 6, "CENTER"), dCell("Mars", 69), dCell("", 12), dCell("", 8)]),
    dRow([dCell("", 5, "CENTER"), dCell("B", 6, "CENTER"), dCell("Matahari", 69), dCell("", 12), dCell("", 8)]),
    dRow([dCell("", 5, "CENTER"), dCell("C", 6, "CENTER"), dCell("Bumi", 69), dCell("", 12), dCell("", 8)]),
    dRow([dCell("", 5, "CENTER"), dCell("D", 6, "CENTER"), dCell("Bulan", 69), dCell("", 12), dCell("", 8)]),
    dRow([dCell("3", 5, "CENTER"), dCell("BSi", 6, "CENTER"), dCell("Pilih B (Benar) jika pernyataan benar, atau S (Salah) jika salah.", 69), dCell("B|S", 12, "CENTER"), dCell("2", 8, "CENTER")]),
    dRow([dCell("", 5, "CENTER"), dCell("P1", 6, "CENTER"), dCell("Air mendidih pada suhu 100C pada tekanan standar.", 69), dCell("", 12), dCell("", 8)]),
    dRow([dCell("", 5, "CENTER"), dCell("P2", 6, "CENTER"), dCell("Matahari terbit dari arah barat.", 69), dCell("", 12), dCell("", 8)]),
    dRow([dCell("4", 5, "CENTER"), dCell("MJ", 6, "CENTER"), dCell("Jodohkan hewan dengan makanannya!", 69), dCell("", 12), dCell("2", 8, "CENTER")]),
    dRow([dCell("", 5, "CENTER"), dCell("MJ1", 6, "CENTER"), dCell("Kucing", 69), dCell("Ikan", 12), dCell("", 8)]),
    dRow([dCell("", 5, "CENTER"), dCell("MJ2", 6, "CENTER"), dCell("Kelinci", 69), dCell("Wortel", 12), dCell("", 8)]),
    dRow([dCell("", 5, "CENTER"), dCell("MJ3", 6, "CENTER"), dCell("Ayam", 69), dCell("Beras", 12), dCell("", 8)]),
    dRow([dCell("", 5, "CENTER"), dCell("MJ4", 6, "CENTER"), dCell("Distractor", 69), dCell("", 12), dCell("", 8)]),
    dRow([dCell("5", 5, "CENTER"), dCell("CAT", 6, "CENTER"), dCell("Kelompokkan hewan berikut!", 69), dCell("", 12), dCell("2", 8, "CENTER")]),
    dRow([dCell("", 5, "CENTER"), dCell("CAT1", 6, "CENTER"), dCell("Kucing", 69), dCell("Mamalia, Vertebrata", 12), dCell("", 8)]),
    dRow([dCell("", 5, "CENTER"), dCell("CAT2", 6, "CENTER"), dCell("Elang", 69), dCell("Burung, Vertebrata", 12), dCell("", 8)]),
    dRow([dCell("6", 5, "CENTER"), dCell("ISIAN", 6, "CENTER"), dCell("Ibu kota Indonesia adalah ... , sedangkan ibu kota Jepang adalah ....", 69), dCell("Jakarta, jakarta | Tokyo, tokyo", 12, "CENTER"), dCell("2", 8, "CENTER")]),
    dRow([dCell("7", 5, "CENTER"), dCell("ESAI", 6, "CENTER"), dCell("Jelaskan proses terjadinya hujan! Berikan minimal 3 tahap.", 69), dCell("", 12), dCell("5", 8, "CENTER")]),
];

const doc = new Document({
    styles: { default: { document: { run: { font: "Calibri", size: 20 } } } },
    sections: [{
        properties: { page: { margin: { top: 720, bottom: 720, left: 720, right: 720 } } },
        children: [
            new Paragraph({ children: [new TextRun({ text: "TEMPLATE IMPORT SOAL", bold: true, size: 32 })], alignment: AlignmentType.CENTER, spacing: { after: 100 } }),
            new Paragraph({ children: [new TextRun({ text: "Bank Soal", size: 24, color: "555555" })], alignment: AlignmentType.CENTER, spacing: { after: 400 } }),
            ...instr,
            new Paragraph({ children: [new TextRun({ text: "KODE TIPE SOAL", bold: true, size: 22 })], spacing: { after: 150 } }),
            new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: legendRows }),
            sp(300),
            new Paragraph({ children: [new TextRun({ text: "TABEL IMPORT SOAL", bold: true, size: 22 })], spacing: { after: 150 } }),
            new Paragraph({ children: [new TextRun({ text: "(Baris sub-soal WAJIB menggunakan TIPE yang sama dengan baris pertanyaan utama.)", size: 18, color: "666666", italics: true })], spacing: { after: 150 } }),
            new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: mainRows }),
        ],
    }],
});

const tmpPath = path.join("C:/Users/imran/AppData/Local/Temp", "template_soal_new.docx");
Packer.toBuffer(doc).then(buf => {
    fs.writeFileSync(tmpPath, buf);
    console.log("OK:", tmpPath, buf.length, "bytes");
}).catch(err => {
    console.error("Error:", err);
    process.exit(1);
});
