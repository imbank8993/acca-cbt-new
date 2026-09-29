# Tahap 59 — Matching dan format jawaban kompleks

Diperbarui 29 September 2026. Tahap ini melanjutkan target lint nol tanpa mematikan atau melonggarkan aturan.

## Matching interaktif

- Komponen mempunyai kontrak eksplisit untuk identitas soal/siswa, opsi, item kanan, pasangan jawaban, pilihan kiri, dan callback.
- Pengacakan deterministik dibuat generik sehingga tipe opsi dan item kanan tidak hilang setelah shuffle.
- Pasangan jawaban diperiksa sebagai `Record<string, string[]>` sebelum mencari posisi panah atau status item.
- Pemeriksaan item yang sudah terhubung tidak lagi membaca isi objek bebas.
- Metadata pasangan benar berasal dari kontrak `QuestionOption`, termasuk bentuk tunggal `match_text` dan jamak `match_texts`.
- Urutan acak tetap stabil per kombinasi siswa dan soal.

## Formatter jawaban

- Metadata soal dan opsi mempunyai kontrak untuk matching, kategori, dan blank isian.
- JSON jawaban lama diperlakukan sebagai `unknown` dan hanya dibaca setelah terbukti berupa record atau array.
- Esai hanya membaca teks, daftar lampiran, dan URL video dengan tipe yang sesuai.
- Pilihan ganda kompleks hanya menerima ID string.
- Benar/salah, checklist, matching, kategori, ordering, ranking, dan isian singkat memeriksa bentuk nilainya sebelum mengakses kunci dinamis.
- Kunci matching, kategorisasi, dan isian singkat menyaring nilai metadata yang bukan string atau array.

## Hasil

Lint frontend berubah dari **155 error/14 warning** pada akhir Tahap 58 menjadi **138 error/14 warning**. Tahap ini menghapus 17 masalah. Dibanding awal pembersihan lint, total turun dari 1.804 menjadi 152 masalah.

Sisa saat ini:

- 120 penggunaan `any`;
- 14 dependency hook;
- 12 pembaruan state langsung di effect;
- 4 pelanggaran immutability hook;
- 2 memoization yang tidak dapat dipertahankan compiler.

## Verifikasi

- TypeScript frontend: lulus.
- Matching interaktif dan formatter jawaban: lint nol.
- 9 regresi validasi jawaban, autosave, bulk sync, timeout, retry submit, dan snapshot terbaru: lulus.
- ESLint frontend penuh: 138 error/14 warning.

## Tahap berikutnya

Bersihkan halaman ringkasan Guru, Admin, dan Proktor sebagai satu kelompok agar kontrak statistik dan lifecycle dashboard tetap konsisten antarperan.
