const {
  Document, Packer, Paragraph, Table, TableRow, TableCell,
  TextRun, WidthType, AlignmentType, HeadingLevel,
  BorderStyle, ShadingType, TableLayoutType, VerticalAlign,
} = require('docx');
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'public');

// ── Shared border & cell helpers ──────────────────────────────────────────────

const THIN_BORDER = { style: BorderStyle.SINGLE, size: 4, color: 'BBBBBB' };
const ALL_BORDERS = { top: THIN_BORDER, bottom: THIN_BORDER, left: THIN_BORDER, right: THIN_BORDER };

function hCell(text, shade = '1E3A5F') {
  return new TableCell({
    shading: { type: ShadingType.SOLID, color: shade },
    verticalAlign: VerticalAlign.CENTER,
    borders: ALL_BORDERS,
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text, bold: true, color: 'FFFFFF', size: 18, font: 'Calibri' })],
    })],
  });
}

function cell(text = '', opts = {}) {
  const { bold = false, shade, align = AlignmentType.LEFT, size = 18 } = opts;
  return new TableCell({
    shading: shade ? { type: ShadingType.SOLID, color: shade } : undefined,
    verticalAlign: VerticalAlign.CENTER,
    borders: ALL_BORDERS,
    children: [new Paragraph({
      alignment: align,
      children: [new TextRun({ text, bold, size, font: 'Calibri', color: shade ? undefined : '1E293B' })],
    })],
  });
}

// number cell — centered
function nc(text) { return cell(text, { align: AlignmentType.CENTER }); }
// type cell — centered, semi-bold
function tc(text, shade) { return cell(text, { bold: true, align: AlignmentType.CENTER, shade }); }
// key cell — centered
function kc(text) { return cell(text, { align: AlignmentType.CENTER }); }
// empty cell
function ec() { return cell(''); }

function noteP(text) {
  return new Paragraph({
    spacing: { before: 80, after: 80 },
    children: [new TextRun({ text, italics: true, size: 17, color: '64748B', font: 'Calibri' })],
  });
}

function heading(text, color = '1E3A5F') {
  return new Paragraph({
    spacing: { before: 320, after: 100 },
    children: [new TextRun({ text, bold: true, size: 24, color, font: 'Calibri' })],
  });
}

function space() {
  return new Paragraph({ spacing: { before: 80, after: 80 }, children: [new TextRun('')] });
}

// ══════════════════════════════════════════════════════════════════════════════
// TEMPLATE AKADEMIK
// Kolom: No | Tipe | Stimulus | Petunjuk | Soal/Pertanyaan/Opsi | Kunci | Poin | Kisi-kisi
// Lebar kolom (dxa, total ~9900):
//  No=500 Tipe=700 Stimulus=900 Petunjuk=900 Soal=4200 Kunci=800 Poin=500 KisiKisi=1400
// ══════════════════════════════════════════════════════════════════════════════

function buildAkademik() {
  const COL_W = [500, 700, 900, 900, 4200, 800, 500, 1400];
  const HDR_COLOR = '1E3A5F';
  const SUB_SHADE = 'F8FAFC';   // very light for sub-rows

  function headerRow() {
    return new TableRow({
      tableHeader: true,
      children: [
        hCell('No', HDR_COLOR),
        hCell('Tipe', HDR_COLOR),
        hCell('Stimulus', HDR_COLOR),
        hCell('Petunjuk', HDR_COLOR),
        hCell('Soal / Pertanyaan / Opsi', HDR_COLOR),
        hCell('Kunci', HDR_COLOR),
        hCell('Poin', HDR_COLOR),
        hCell('Kisi-kisi', HDR_COLOR),
      ],
    });
  }

  // main row for a question (kisi = kode kisi-kisi, misal [K1])
  function mainRow(no, tipe, stim, pet, soal, kunci, poin, kisi = '') {
    return new TableRow({ children: [nc(no), tc(tipe), nc(stim), nc(pet), cell(soal), kc(kunci), nc(poin), nc(kisi)] });
  }

  // sub-row for options — kisi kolom kosong di sub-baris
  function subRow(label, text, kunci = '', shade = SUB_SHADE) {
    return new TableRow({
      children: [
        cell('', { shade }), tc(label, shade),
        cell('', { shade }), cell('', { shade }),
        cell(text, { shade }),
        kc(kunci), cell('', { shade }), cell('', { shade }),
      ],
    });
  }

  const rows = [
    headerRow(),

    // 1. PG
    mainRow('1','PG','[S1]','[I1]','Siapakah presiden pertama Republik Indonesia?','A','1','[K1]'),
    subRow('A','Soekarno'),
    subRow('B','Soeharto'),
    subRow('C','Habibie'),
    subRow('D','Megawati'),

    // 2. PGK
    mainRow('2','PGK','[S2]','[I2]','Manakah yang merupakan planet? (jawaban lebih dari satu)','A,C','2','[K2]'),
    subRow('A','Mars'),
    subRow('B','Matahari'),
    subRow('C','Bumi'),
    subRow('D','Bulan'),

    // 3. BS (True/False) — P1, P2 sub-rows
    mainRow('3','BS','','[I3]','Pilih B (Benar) jika pernyataan benar, atau S (Salah) jika salah.','B|S','2','[K2]'),
    subRow('P1','Air mendidih pada suhu 100°C pada tekanan standar.','B'),
    subRow('P2','Matahari terbit dari arah barat.','S'),

    // 4. MJ (Matching)
    mainRow('4','MJ','','','Jodohkan hewan dengan makanannya!','','2','[K3]'),
    subRow('MJ1','Kucing','Ikan'),
    subRow('MJ2','Kelinci','Wortel'),
    subRow('MJ3','Ayam','Beras'),
    subRow('MJ4','Distractor',''),

    // 5. CAT (Categorization)
    mainRow('5','CAT','','','Kelompokkan hewan berikut!','','2','[K3]'),
    subRow('CAT1','Kucing','Mamalia, Vertebrata'),
    subRow('CAT2','Elang','Burung, Vertebrata'),
    subRow('CAT3','Salmon','Ikan, Vertebrata'),

    // 6. ISIAN (Short Answer)
    mainRow('6','ISIAN','','[I4]','Ibu kota Indonesia adalah ___., sedangkan ibu kota Jepang adalah ___.','Jakarta, Jakarta | Tokyo, tokyo','2','[K1]'),

    // 7. ESAI (Essay)
    mainRow('7','ESAI','[S3]','','Jelaskan proses terjadinya hujan! Berikan minimal 3 tahap.','(Manual)','5','[K3]'),

    // 8. URUT (Ordering)
    mainRow('8','URUT','','[I5]','Urutkan langkah-langkah metode ilmiah berikut dari yang pertama!','2;1;4;3','2','[K2]'),
    subRow('U1','Merumuskan masalah'),
    subRow('U2','Melakukan observasi'),
    subRow('U3','Membuat hipotesis'),
    subRow('U4','Menarik kesimpulan'),
  ];

  const mainTable = new Table({
    layout: TableLayoutType.FIXED,
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: COL_W,
    rows,
  });

  // ── Stimulus table ──
  const stiW = [800, 1400, 6800];
  const stiTable = new Table({
    layout: TableLayoutType.FIXED,
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: stiW,
    rows: [
      new TableRow({ tableHeader: true, children: [hCell('Kode'), hCell('Judul'), hCell('Isi Stimulus')] }),
      new TableRow({ children: [nc('[S1]'), cell('Teks Sejarah'), cell('Pada tanggal 17 Agustus 1945...')] }),
      new TableRow({ children: [nc('[S2]'), cell('Tata Surya'), cell('Tata surya terdiri dari Matahari dan delapan planet...')] }),
      new TableRow({ children: [nc('[S3]'), cell('Siklus Air'), cell('Air di bumi mengalami daur yang terus berulang...')] }),
    ],
  });

  // ── Petunjuk table ──
  const petW = [800, 1400, 6800];
  const petTable = new Table({
    layout: TableLayoutType.FIXED,
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: petW,
    rows: [
      new TableRow({ tableHeader: true, children: [hCell('Kode'), hCell('Judul'), hCell('Isi Petunjuk')] }),
      new TableRow({ children: [nc('[I1]'), cell('Petunjuk PG'), cell('Pilihlah satu jawaban yang paling tepat!')] }),
      new TableRow({ children: [nc('[I2]'), cell('Petunjuk PGK'), cell('Pilihlah semua jawaban yang benar (bisa lebih dari satu)!')] }),
      new TableRow({ children: [nc('[I3]'), cell('Petunjuk BS'), cell('Tentukan apakah pernyataan berikut Benar (B) atau Salah (S).')] }),
      new TableRow({ children: [nc('[I4]'), cell('Petunjuk Isian'), cell('Isilah titik-titik dengan jawaban yang tepat!')] }),
      new TableRow({ children: [nc('[I5]'), cell('Petunjuk Urutan'), cell('Urutkan item berikut dari yang pertama (nomor 1) hingga terakhir.')] }),
    ],
  });

  // ── Kisi-kisi table ──
  const kisiW = [800, 1800, 2000, 4400];
  const kisiTable = new Table({
    layout: TableLayoutType.FIXED,
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: kisiW,
    rows: [
      new TableRow({ tableHeader: true, children: [hCell('Kode'), hCell('Kompetensi Dasar'), hCell('Materi'), hCell('Indikator Soal')] }),
      new TableRow({ children: [nc('[K1]'), cell('3.1 Memahami sejarah Indonesia'), cell('Proklamasi Kemerdekaan'), cell('Siswa dapat menyebutkan tokoh proklamasi kemerdekaan Indonesia.')] }),
      new TableRow({ children: [nc('[K2]'), cell('3.2 Memahami sistem tata surya'), cell('Planet dan Benda Langit'), cell('Siswa dapat membedakan planet, bintang, dan benda langit lainnya.')] }),
      new TableRow({ children: [nc('[K3]'), cell('3.3 Memahami keanekaragaman hayati'), cell('Klasifikasi Makhluk Hidup'), cell('Siswa dapat mengelompokkan makhluk hidup berdasarkan ciri-cirinya.')] }),
    ],
  });

  return new Document({
    styles: {
      default: { document: { run: { font: 'Calibri', size: 18 } } },
    },
    sections: [{
      properties: { page: { margin: { top: 720, bottom: 720, left: 900, right: 900 } } },
      children: [
        new Paragraph({
          spacing: { before: 0, after: 100 },
          children: [new TextRun({ text: 'TEMPLATE IMPORT SOAL AKADEMIK', bold: true, size: 28, color: '1E3A5F', font: 'Calibri' })],
        }),
        noteP('Gunakan file ini sebagai panduan format import soal akademik ke sistem CBT.'),

        heading('TABEL IMPORT SOAL'),
        noteP('(Baris sub-soal WAJIB menggunakan TIPE yang sama dengan baris pertanyaan utama.)'),
        space(),
        mainTable,

        heading('TABEL KISI-KISI / MATERI'),
        noteP('Kode kisi-kisi digunakan di kolom Kisi-kisi pada tabel soal. Gunakan kode [K1], [K2], dst.'),
        space(),
        kisiTable,

        heading('TABEL STIMULUS (Opsional)'),
        noteP('Kode stimulus digunakan di kolom Stimulus pada tabel soal. Hapus tabel ini jika tidak ada stimulus.'),
        space(),
        stiTable,

        heading('TABEL PETUNJUK'),
        noteP('Kode petunjuk digunakan di kolom Petunjuk pada tabel soal.'),
        space(),
        petTable,

        heading('PANDUAN KUNCI JAWABAN', '059669'),
        ...[
          'PG        : Huruf opsi yang benar, misal: A',
          'PGK       : Huruf dipisah koma, misal: A,C',
          'BS        : B atau S untuk setiap pernyataan di kolom Kunci sub-baris (P1, P2, dst)',
          'MJ        : Teks kolom kanan (jawaban pasangan) di kolom Kunci sub-baris',
          'CAT       : Nama kategori di kolom Kunci sub-baris (bisa lebih dari satu, pisah koma)',
          'ISIAN     : Jawaban benar, jika ada alternatif pisahkan dengan | (pipa)',
          'ESAI      : Tulis "(Manual)" — dinilai oleh guru',
          'URUT      : Urutan posisi yang benar pisah titik koma, misal: 2;1;4;3 (artinya U2 pertama, U1 kedua, dst)',
        ].map(t => new Paragraph({
          spacing: { before: 40, after: 40 },
          children: [new TextRun({ text: t, size: 17, font: 'Courier New', color: '1E293B' })],
        })),
      ],
    }],
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// TEMPLATE KEPRIBADIAN
// Kolom: No | Tipe | Stimulus | Petunjuk | Pernyataan / Opsi | Dimensi | Bobot | Kisi-kisi
// ══════════════════════════════════════════════════════════════════════════════

function buildKepribadian() {
  const HDR_COLOR = '4338CA';
  const SUB_SHADE = 'F5F3FF';
  const COL_W = [500, 800, 800, 800, 3800, 1200, 500, 1300];

  function headerRow() {
    return new TableRow({
      tableHeader: true,
      children: [
        hCell('No', HDR_COLOR), hCell('Tipe', HDR_COLOR),
        hCell('Stimulus', HDR_COLOR), hCell('Petunjuk', HDR_COLOR),
        hCell('Pernyataan / Opsi', HDR_COLOR),
        hCell('Dimensi', HDR_COLOR), hCell('Bobot', HDR_COLOR),
        hCell('Kisi-kisi', HDR_COLOR),
      ],
    });
  }

  function mainRow(no, tipe, stim, pet, teks, dim = '', bobot = '', kisi = '') {
    return new TableRow({ children: [nc(no), tc(tipe, undefined), nc(stim), nc(pet), cell(teks), cell(dim), nc(bobot), nc(kisi)] });
  }

  function subRow(label, teks, dim = '', bobot = '') {
    return new TableRow({
      children: [
        cell('', { shade: SUB_SHADE }), tc(label, SUB_SHADE),
        cell('', { shade: SUB_SHADE }), cell('', { shade: SUB_SHADE }),
        cell(teks, { shade: SUB_SHADE }),
        cell(dim, { shade: SUB_SHADE }), nc(bobot || ''), cell('', { shade: SUB_SHADE }),
      ],
    });
  }

  const rows = [
    headerRow(),

    // SJT
    mainRow('1','SJT','[S1]','[I1]','Anda melihat teman melanggar aturan kelas. Apa yang Anda lakukan?','','','[K1]'),
    subRow('A','Diam saja dan pura-pura tidak tahu.','Integritas','0'),
    subRow('B','Menegur secara pribadi dengan sopan.','Integritas','3'),
    subRow('C','Melaporkan kepada guru piket.','Disiplin','2'),
    subRow('D','Mengajak teman lain untuk menasehati bersama.','Kerja Sama','1'),

    // Likert
    mainRow('2','LIKERT','','[I2]','Saya selalu menyelesaikan tugas tepat waktu.','Disiplin','','[K2]'),
    mainRow('3','LIKERT','','[I2]','Saya senang membantu teman yang kesulitan belajar.','Kerja Sama','','[K2]'),

    // Forced-Choice
    mainRow('4','FC','','[I3]','Pilih pernyataan yang paling menggambarkan diri Anda:','','','[K1]'),
    subRow('FC1','Saya orang yang sangat disiplin dalam setiap hal.','Disiplin',''),
    subRow('FC2','Saya lebih suka menyelesaikan pekerjaan secara mandiri.','Mandiri',''),
    subRow('FC3','Saya selalu berusaha menjaga kepercayaan orang lain.','Integritas',''),
    subRow('FC4','Saya senang berkolaborasi dalam tim.','Kerja Sama',''),

    // Checklist
    mainRow('5','CEK','','[I4]','Centang kebiasaan yang sering Anda lakukan:','','','[K1]'),
    subRow('C1','Datang ke sekolah sebelum bel masuk.','Disiplin','1'),
    subRow('C2','Belajar secara mandiri tanpa disuruh.','Mandiri','1'),
    subRow('C3','Membantu teman yang sedang kesulitan.','Kerja Sama','1'),
    subRow('C4','Mengakui kesalahan sendiri dengan jujur.','Integritas','1'),

    // Ranking
    mainRow('6','RANK','','[I5]','Urutkan nilai berikut dari yang paling penting bagi Anda (1=paling penting):','','','[K2]'),
    subRow('R1','Disiplin waktu','Disiplin',''),
    subRow('R2','Kejujuran','Integritas',''),
    subRow('R3','Kerja keras mandiri','Mandiri',''),
    subRow('R4','Kebersamaan dalam tim','Kerja Sama',''),

    // Paired Comparison
    mainRow('7','PC','','[I6]','Dari dua pernyataan berikut, pilih satu yang lebih menggambarkan diri Anda:','','','[K1]'),
    subRow('P-A','Saya lebih suka bekerja sendiri dengan penuh konsentrasi.','Mandiri',''),
    subRow('P-B','Saya lebih suka bekerja dalam tim yang solid.','Kerja Sama',''),
  ];

  const mainTable = new Table({
    layout: TableLayoutType.FIXED,
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: COL_W,
    rows,
  });

  // Petunjuk table
  const petW = [800, 1400, 6800];
  const petTable = new Table({
    layout: TableLayoutType.FIXED,
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: petW,
    rows: [
      new TableRow({ tableHeader: true, children: [hCell('Kode', HDR_COLOR), hCell('Judul', HDR_COLOR), hCell('Isi Petunjuk', HDR_COLOR)] }),
      new TableRow({ children: [nc('[I1]'), cell('SJT'), cell('Pilih tindakan yang paling tepat menurut Anda dalam situasi berikut.')] }),
      new TableRow({ children: [nc('[I2]'), cell('Likert'), cell('Nyatakan tingkat persetujuan Anda (1=Sangat Tidak Setuju, 5=Sangat Setuju).')] }),
      new TableRow({ children: [nc('[I3]'), cell('Forced-Choice'), cell('Pilih SATU pernyataan yang paling menggambarkan diri Anda.')] }),
      new TableRow({ children: [nc('[I4]'), cell('Checklist'), cell('Centang semua pernyataan yang sesuai dengan kebiasaan Anda.')] }),
      new TableRow({ children: [nc('[I5]'), cell('Ranking'), cell('Urutkan item berikut dari yang paling sesuai (1=paling sesuai) hingga kurang sesuai.')] }),
      new TableRow({ children: [nc('[I6]'), cell('Paired Comparison'), cell('Dari dua pernyataan, pilih satu yang lebih menggambarkan diri Anda.')] }),
    ],
  });

  // Kisi-kisi table
  const kisiW = [800, 1800, 2000, 4400];
  const kisiTable = new Table({
    layout: TableLayoutType.FIXED,
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: kisiW,
    rows: [
      new TableRow({ tableHeader: true, children: [hCell('Kode', HDR_COLOR), hCell('Aspek / Kompetensi', HDR_COLOR), hCell('Materi / Indikator', HDR_COLOR), hCell('Keterangan', HDR_COLOR)] }),
      new TableRow({ children: [nc('[K1]'), cell('Integritas & Kejujuran'), cell('Perilaku jujur dalam kehidupan sehari-hari'), cell('Mengukur nilai integritas dan tanggung jawab pribadi siswa.')] }),
      new TableRow({ children: [nc('[K2]'), cell('Disiplin & Kemandirian'), cell('Pengelolaan waktu dan belajar mandiri'), cell('Mengukur kedisiplinan dan kemampuan belajar tanpa pengawasan.')] }),
    ],
  });

  // Stimulus table
  const stiW = [800, 1400, 6800];
  const stiTable = new Table({
    layout: TableLayoutType.FIXED,
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: stiW,
    rows: [
      new TableRow({ tableHeader: true, children: [hCell('Kode', HDR_COLOR), hCell('Judul', HDR_COLOR), hCell('Isi Stimulus', HDR_COLOR)] }),
      new TableRow({ children: [nc('[S1]'), cell('Situasi Sekolah'), cell('Di lingkungan sekolah Anda, terdapat berbagai situasi yang membutuhkan pertimbangan moral...')] }),
    ],
  });

  return new Document({
    styles: {
      default: { document: { run: { font: 'Calibri', size: 18 } } },
    },
    sections: [{
      properties: { page: { margin: { top: 720, bottom: 720, left: 900, right: 900 } } },
      children: [
        new Paragraph({
          spacing: { before: 0, after: 100 },
          children: [new TextRun({ text: 'TEMPLATE IMPORT SOAL KEPRIBADIAN', bold: true, size: 28, color: '4338CA', font: 'Calibri' })],
        }),
        noteP('Gunakan file ini sebagai panduan format import soal kepribadian/psikotes ke sistem CBT.'),

        heading('TABEL IMPORT SOAL KEPRIBADIAN', '4338CA'),
        noteP('Kode Tipe: SJT | LIKERT | FC (Forced-Choice) | CEK (Checklist) | RANK (Ranking) | PC (Paired Comparison)'),
        noteP('Kolom Dimensi wajib diisi sesuai nama dimensi yang sudah dibuat di tab Dimensi pada bank soal.'),
        space(),
        mainTable,

        heading('TABEL KISI-KISI / MATERI', '059669'),
        noteP('Kode kisi-kisi digunakan di kolom Kisi-kisi pada tabel soal. Gunakan kode [K1], [K2], dst.'),
        space(),
        kisiTable,

        heading('TABEL PETUNJUK', '7C3AED'),
        noteP('Kode petunjuk digunakan di kolom Petunjuk pada tabel soal di atas.'),
        space(),
        petTable,

        heading('TABEL STIMULUS (Opsional)', '2563EB'),
        noteP('Kode stimulus digunakan di kolom Stimulus pada tabel soal di atas. Hapus tabel ini jika tidak ada stimulus.'),
        space(),
        stiTable,

        heading('PANDUAN PENGISIAN', '059669'),
        ...[
          'SJT    : Setiap sub-opsi (A, B, C, D) wajib mengisi Dimensi dan Bobot (angka 0–3).',
          'LIKERT : Tidak ada sub-baris; cukup 1 baris dengan Dimensi. Siswa memilih skala 1–5.',
          'FC     : Sub-baris FC1–FC4 masing-masing dengan Dimensi berbeda. Siswa pilih satu.',
          'CEK    : Sub-baris C1–Cn dengan Dimensi dan Bobot = 1. Siswa bisa pilih lebih dari satu.',
          'RANK   : Sub-baris R1–Rn dengan Dimensi. Peringkat 1 mendapat poin tertinggi otomatis.',
          'PC     : Hanya 2 sub-baris (P-A dan P-B), masing-masing Dimensi berbeda. Siswa pilih satu.',
        ].map(t => new Paragraph({
          spacing: { before: 40, after: 40 },
          children: [new TextRun({ text: t, size: 17, font: 'Courier New', color: '1E293B' })],
        })),
      ],
    }],
  });
}

// ── Generate ──────────────────────────────────────────────────────────────────
async function main() {
  console.log('Generating templates...');
  const a = buildAkademik();
  fs.writeFileSync(path.join(OUT_DIR, 'template_soal_akademik.docx'), await Packer.toBuffer(a));
  console.log('✓ template_soal_akademik.docx');

  const k = buildKepribadian();
  fs.writeFileSync(path.join(OUT_DIR, 'template_soal_kepribadian.docx'), await Packer.toBuffer(k));
  console.log('✓ template_soal_kepribadian.docx');

  console.log('Done!');
}

main().catch(console.error);
