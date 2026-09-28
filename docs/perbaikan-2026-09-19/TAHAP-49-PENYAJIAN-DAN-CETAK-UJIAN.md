# Tahap 49 — Penyajian dan cetak ujian

Diperbarui 28 September 2026. Tahap ini melanjutkan target lint nol tanpa mematikan atau melonggarkan aturan.

## Perbaikan

- `ExamViewer` memakai kontrak `Question` dan `AnswerValue` untuk daftar soal, status jawaban, perubahan jawaban, serta navigasi.
- Pemeriksaan jawaban parsial menangani hasil JSON sebagai `unknown` dan hanya membaca kunci setelah memastikan nilainya objek.
- Metadata tugas yang dipakai layar—deskripsi, video, dokumen, izin unggah, dan tipe berkas—memiliki kontrak eksplisit yang sama dengan metadata ujian siswa.
- Tombol navigasi desktop dan mobile tidak lagi mengulang callback `any` untuk setiap soal.
- Tampilan cetak memakai kontrak bank dan soal. Penyaringan serta pengurutan opsi, daftar pasangan, kategori, dan blank sekarang mendapat tipe dari data soal.
- Kontrak soal siswa disatukan dengan tipe `Question` yang digunakan komponen renderer, sehingga `ExamPage`, `ExamViewer`, dan kartu soal memakai bentuk data yang sama.

## Hasil

Lint frontend berubah dari **446 error/28 warning** pada akhir Tahap 48 menjadi **418 error/28 warning**. Tahap ini menghapus 28 masalah. Dibanding awal pembersihan lint, total turun dari 1.804 menjadi 446 masalah.

Sisa saat ini:

- 386 penggunaan `any`;
- 28 dependency hook;
- 17 pembaruan state langsung di effect;
- 13 pelanggaran immutability hook;
- 2 memoization yang tidak dapat dipertahankan compiler.

## Verifikasi

- TypeScript frontend: lulus.
- `ExamPage`, `ExamViewer`, tampilan cetak, dan penyimpanan pemulihan: lint nol.
- ESLint frontend penuh: 418 error/28 warning.
- `git diff --check`: tidak menemukan whitespace error sebelum dokumentasi tahap ini ditulis.

## Tahap berikutnya

Selesaikan `QuestionRenderer` dan `PreviewModal`, lalu lengkapi kontrak kelas, jadwal, hasil, dan detail attempt pada API siswa. Sesudah jalur data siswa bersih, tuntaskan sisa lifecycle hook.
