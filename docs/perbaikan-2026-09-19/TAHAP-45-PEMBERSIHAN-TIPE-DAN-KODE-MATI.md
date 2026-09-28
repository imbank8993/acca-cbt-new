# Tahap 45 — Pembersihan tipe dan kode mati

Diperbarui 28 September 2026. Tahap ini melanjutkan target lint nol tanpa mematikan atau melonggarkan aturan.

## Perbaikan

- TypeScript Language Service menghapus 207 deklarasi, parameter, dan state lama yang sudah tidak mempunyai pemanggil.
- Modul ekspor Word memiliki tipe eksplisit untuk soal, opsi, stimulus, petunjuk, kisi-kisi, dimensi, dan bank; 51 penggunaan `any` di modul tersebut dihapus.
- Nilai yang ditangkap oleh `catch` diperlakukan sebagai `unknown` dan diterjemahkan melalui `getErrorMessage`, sehingga kode tidak lagi menganggap semua nilai lemparan memiliki properti `message`.
- API bank soal sekarang mengembalikan `QuestionBank`, `QuestionRecord`, folder, label, opsi, dan metadata yang bertipe.
- Halaman detail bank soal dan editor soal memakai kontrak tersebut dari pemuatan data sampai pratinjau dan penyimpanan. Keduanya kini nol lint.
- Sinkronisasi modal dari parameter URL dijadwalkan di luar badan effect dan callback editor dibuat stabil, sehingga tidak menghasilkan render berantai.
- Komponen web `math-field` memiliki deklarasi JSX; komentar penekan TypeScript dihapus.
- Parser DOCX memakai import ESM untuk DOM parser/serializer dan deklarasi modul untuk `omml2mathml`; `require` dan `@ts-ignore` dihapus.
- Gambar antarmuka memakai `next/image`, teks JSX sudah di-escape, display name komponen memo ditambahkan, dan tautan font Google lama dihapus.

## Hasil

Lint frontend berubah dari 1.128 error/318 warning pada akhir Tahap 44 menjadi **871 error/52 warning**. Tahap ini menghapus 523 masalah. Dibanding awal pembersihan lint, total turun dari 1.804 menjadi 923 masalah.

Seluruh aturan kecil di luar keluarga hooks dan `no-explicit-any` sudah bersih. Sisa saat ini:

- 812 penggunaan `any`;
- 52 dependency hook;
- 26 pembaruan state langsung di effect;
- 25 pelanggaran immutability hook;
- 8 memoization yang tidak dapat dipertahankan compiler.

## Verifikasi

- TypeScript frontend: lulus.
- API bank soal, halaman detail bank, dan editor soal: lint nol.
- ESLint frontend penuh: 871 error/52 warning.
- `git diff --check`: tidak menemukan whitespace error sebelum dokumentasi tahap ini ditulis.

## Tahap berikutnya

Definisikan kontrak API proktor, ujian, dan siswa, lalu gunakan kontrak itu pada tiga halaman peran yang masih kembar. Setelah `any` turun, perbaiki lifecycle halaman monitoring, daftar ujian, dan halaman hasil siswa sampai seluruh aturan hooks bersih.
