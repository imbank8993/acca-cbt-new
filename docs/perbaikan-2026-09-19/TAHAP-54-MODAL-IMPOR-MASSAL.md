# Tahap 54 — Modal impor massal

Diperbarui 28 September 2026. Tahap ini melanjutkan target lint nol tanpa mematikan atau melonggarkan aturan.

## Perbaikan

- Daftar bank sumber memakai kontrak `QuestionBank` dari API.
- Soal sumber memakai kontrak `QuestionRecord` dan menyimpan hasil portabel yang sudah bertipe.
- Pemilihan semua soal, filter pencarian, dan render jumlah opsi tidak lagi membaca objek bebas.
- Payload lintas bank dibentuk dari hasil `portableQuestion`, termasuk tipe, tingkat kesulitan, skor, metadata, opsi, bobot, dan kunci.
- Modal tidak lagi menjalankan konversi kedua dengan bentuk data yang belum pasti saat pengguna menekan impor.
- Properti opsi yang mungkin tidak ada ditangani tanpa akses langsung yang dapat gagal.

## Hasil

Lint frontend berubah dari **331 error/24 warning** pada akhir Tahap 53 menjadi **321 error/24 warning**. Tahap ini menghapus 10 masalah. Dibanding awal pembersihan lint, total turun dari 1.804 menjadi 345 masalah.

Sisa saat ini:

- 294 penggunaan `any`;
- 24 dependency hook;
- 14 pembaruan state langsung di effect;
- 11 pelanggaran immutability hook;
- 2 memoization yang tidak dapat dipertahankan compiler.

## Verifikasi

- TypeScript frontend: lulus.
- Modal impor massal, parser DOCX, dan pembaca arsip: lint nol.
- ESLint frontend penuh: 321 error/24 warning.

## Tahap berikutnya

Bersihkan kontrak transfer soal bersama agar ekspor dan impor memakai bentuk yang sama tanpa `any`. Setelah itu lanjutkan halaman kelas Admin, Guru, dan Proktor.
