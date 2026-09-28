# Tahap 50 — Renderer dan pratinjau soal

Diperbarui 28 September 2026. Tahap ini melanjutkan target lint nol tanpa mematikan atau melonggarkan aturan.

## Perbaikan

- `QuestionRenderer` memakai kontrak eksplisit untuk metadata, stimulus, petunjuk, opsi, dan jawaban esai.
- Metadata lama yang tersimpan sebagai JSON dibaca sebagai `unknown`. Nilai kosong, array, JSON rusak, atau bentuk yang bukan objek ditolak dengan aman.
- Alias stimulus dan petunjuk lama, termasuk bentuk array, dinormalisasi ke satu item sebelum ditampilkan.
- Jawaban esai bertipe objek hanya menerima teks, URL berkas, URL video, dan ID topik dengan tipe yang benar. Daftar berkas menyaring nilai selain string.
- `StimulusViewer` memakai kontrak stimulus yang sama dengan renderer.
- `PreviewModal` menormalisasi opsi API ke kontrak opsi renderer. Jawaban pilihan ganda kompleks dengan JSON rusak tidak lagi dapat menjatuhkan halaman pratinjau; data tersebut dihitung sebagai jawaban kosong.
- Bentuk metadata mendukung pengaturan multi-topik, unggah berkas, tautan video, dan variasi jawaban singkat yang memang dipakai renderer.

## Hasil

Lint frontend berubah dari **418 error/28 warning** pada akhir Tahap 49 menjadi **392 error/28 warning**. Tahap ini menghapus 26 masalah. Dibanding awal pembersihan lint, total turun dari 1.804 menjadi 420 masalah.

Sisa saat ini:

- 360 penggunaan `any`;
- 28 dependency hook;
- 17 pembaruan state langsung di effect;
- 13 pelanggaran immutability hook;
- 2 memoization yang tidak dapat dipertahankan compiler.

## Verifikasi

- TypeScript frontend: lulus.
- `QuestionRenderer`, `PreviewModal`, dan `StimulusViewer`: lint nol.
- ESLint frontend penuh: 392 error/28 warning.
- `git diff --check`: tidak menemukan whitespace error sebelum dokumentasi tahap ini ditulis.

## Tahap berikutnya

Bersihkan kontrak hasil siswa dan halaman peninjauan attempt karena jalur tersebut membaca jawaban serta metadata historis dari server. Setelah itu lanjutkan parser dokumen impor dan halaman kelas yang masih menjadi kelompok temuan terbesar.
