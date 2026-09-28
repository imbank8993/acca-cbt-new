# Tahap 53 — Parser DOCX dan arsip soal

Diperbarui 28 September 2026. Tahap ini melanjutkan target lint nol tanpa mematikan atau melonggarkan aturan.

## Perbaikan

- Parser DOCX memiliki kontrak eksplisit untuk metadata soal, metadata opsi, blank, kategori, pasangan, urutan, dimensi, dan kisi-kisi.
- Traversal tabel memakai elemen DOM yang tervalidasi. Baris, grup tabel, dan sel tidak lagi diperlakukan sebagai objek bebas.
- Input Mammoth dibedakan secara eksplisit antara buffer server dan `ArrayBuffer` browser.
- JSON kisi-kisi dibaca sebagai data tidak tepercaya dan setiap bidang diperiksa sebelum dipakai.
- Nomor sumber impor tetap disimpan dan digunakan untuk mengurutkan hasil akhir, sehingga urutan template tetap menjadi urutan soal hasil impor.
- Metadata matching dan kategorisasi dibuat langsung dengan bentuk yang benar tanpa cast paksa.
- Arsip soal tertanam di DOCX memvalidasi objek utama serta setiap soal sebelum mengembalikannya ke proses impor.

## Hasil

Lint frontend berubah dari **352 error/24 warning** pada akhir Tahap 52 menjadi **331 error/24 warning**. Tahap ini menghapus 21 masalah. Dibanding awal pembersihan lint, total turun dari 1.804 menjadi 355 masalah.

Sisa saat ini:

- 304 penggunaan `any`;
- 24 dependency hook;
- 14 pembaruan state langsung di effect;
- 11 pelanggaran immutability hook;
- 2 memoization yang tidak dapat dipertahankan compiler.

## Verifikasi

- TypeScript frontend: lulus.
- Parser DOCX dan pembaca arsip soal: lint nol.
- Regresi sumber soal, workflow, dan idempotensi konten: 14 lulus, 0 gagal.
- ESLint frontend penuh: 331 error/24 warning.

## Tahap berikutnya

Bersihkan modal impor massal dan pastikan kontrak hasil parser dipertahankan sampai proses penyimpanan. Setelah itu lanjutkan halaman kelas Admin, Guru, dan Proktor.
