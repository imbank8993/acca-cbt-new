# Tahap 51 — Hasil dan review siswa

Diperbarui 28 September 2026. Tahap ini melanjutkan target lint nol tanpa mematikan atau melonggarkan aturan.

## Perbaikan

- API siswa memiliki kontrak eksplisit untuk daftar hasil, detail attempt, jawaban, soal, dimensi, interpretasi, kelas, dan jadwal.
- Daftar hasil, detail nilai, dan review jawaban tidak lagi memakai data `any`.
- Detail attempt hanya merender jawaban yang memiliki data soal, sehingga relasi soal historis yang hilang tidak menyebabkan akses properti kosong.
- Jawaban esai lama dinormalisasi dari string atau objek. Teks, daftar lampiran, video, dan skor diperiksa sebelum dipakai.
- Tautan lampiran serta video pada review melewati validasi URL aman dan label lampiran tidak lagi dibuat langsung dari URL mentah.
- Metadata soal review, termasuk pasangan, kategori, blank, topik, dan pembahasan, memakai kontrak renderer yang sama.
- Pemuatan awal dijadwalkan dengan cleanup dan callback stabil sehingga tidak lagi melanggar lifecycle hook.

## Hasil

Lint frontend berubah dari **392 error/28 warning** pada akhir Tahap 50 menjadi **358 error/25 warning**. Tahap ini menghapus 37 masalah. Dibanding awal pembersihan lint, total turun dari 1.804 menjadi 383 masalah.

Sisa saat ini:

- 329 penggunaan `any`;
- 25 dependency hook;
- 15 pembaruan state langsung di effect;
- 12 pelanggaran immutability hook;
- 2 memoization yang tidak dapat dipertahankan compiler.

## Verifikasi

- TypeScript frontend: lulus.
- Daftar hasil, detail attempt, review siswa, dan API siswa: lint nol.
- ESLint frontend penuh: 358 error/25 warning.

## Tahap berikutnya

Gunakan kontrak kelas dan jadwal yang baru pada halaman siswa, lalu bersihkan parser dokumen impor. Setelah itu lanjutkan halaman kelas staf dan alur PAS yang masih memuat kelompok temuan terbesar.
