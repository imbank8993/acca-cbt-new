# Tahap 48 — Editor dan alur pengerjaan ujian

Diperbarui 28 September 2026. Tahap ini melanjutkan target lint nol tanpa mematikan atau melonggarkan aturan.

## Perbaikan

- Editor soal Admin, Guru, dan Proktor memakai kontrak yang sama untuk bank, soal, opsi, metadata, matching, kategorisasi, dan isian singkat.
- Deduplikasi opsi dipindahkan menjadi fungsi murni bertipe. Opsi yang dimuat dari server dinormalisasi agar selalu memiliki status benar, urutan, bobot, serta metadata kategori/matching.
- Metadata `right_items`, `blanks`, `categories`, dan `is_multi_topic` tidak lagi dibaca melalui cast bebas. Nilai awal isian singkat sekarang selalu memiliki bentuk jawaban dan variasi yang valid.
- Komponen inti pengerjaan ujian memakai tipe nyata untuk pengguna, ujian, attempt, soal siswa, opsi, serta jawaban server.
- Paket pemulihan offline memakai kontrak yang sama dengan respons server. Identitas pengguna, ujian, attempt, dan daftar soal yang dipulihkan tidak lagi dicasting sebagai objek bebas.
- Deduplikasi opsi berdasarkan id, antrean autosave per soal, daftar kirim ulang, snapshot lokal, pemulihan reload, batas waktu server, dan submit tetap dipertahankan.
- Penanganan fullscreen lama diberi tipe ekstensi browser yang eksplisit; nama siswa memakai `fullName` dari sesi terverifikasi.
- API siswa sekarang mempunyai kontrak untuk ujian, soal ujian, attempt, dan jawaban tersimpan pada jalur pengerjaan.

## Hasil

Lint frontend berubah dari **555 error/31 warning** pada akhir Tahap 47 menjadi **446 error/28 warning**. Tahap ini menghapus 112 masalah. Dibanding awal pembersihan lint, total turun dari 1.804 menjadi 474 masalah.

Sisa saat ini:

- 414 penggunaan `any`;
- 28 dependency hook;
- 17 pembaruan state langsung di effect;
- 13 pelanggaran immutability hook;
- 2 memoization yang tidak dapat dipertahankan compiler.

## Verifikasi

- TypeScript frontend: lulus.
- Tiga editor soal: lint nol.
- Komponen inti `ExamPage` dan penyimpanan pemulihan durable: lint nol.
- ESLint frontend penuh: 446 error/28 warning.
- `git diff --check`: tidak menemukan whitespace error sebelum dokumentasi tahap ini ditulis.

## Tahap berikutnya

Bersihkan kontrak generik API siswa yang masih dipakai halaman kelas dan hasil, lalu lanjutkan `ExamViewer`, `QuestionRenderer`, serta tampilan cetak. Setelah tipe komponen soal stabil, selesaikan sisa lifecycle hook.
