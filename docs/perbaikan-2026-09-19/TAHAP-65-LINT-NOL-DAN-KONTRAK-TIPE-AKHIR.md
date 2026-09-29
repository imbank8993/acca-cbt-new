# Tahap 65 — Lint nol dan kontrak tipe akhir

Diperbarui 29 September 2026. Tahap ini menyelesaikan seluruh utang lint frontend tanpa mematikan atau melonggarkan aturan.

## Jadwal PAS dan komponen ujian

- Input jadwal massal memakai kontrak periode, kelas, mata pelajaran, bank soal, dan sesi PAS.
- Layout ujian mobile memakai kontrak soal dan ringkasan ujian; objek attempt yang belum digunakan diperlakukan sebagai `unknown`.
- TipTap memakai referensi instance MathLive bertipe, tanpa menyimpan objek editor pada properti global `window`.
- Math renderer mempunyai kontrak properti eksplisit untuk LaTeX, mode tampilan, penyuntingan, salin, dan callback perubahan.

## Formulir dan metadata soal

- Metadata matching, isian singkat, esai, serta ordering memakai tipe schema masing-masing.
- Form kepribadian memakai `DimensionItem`; matching memakai `React.Key`; pemilih berkas kategorisasi memakai `Event` dan `HTMLInputElement`.
- Interpretasi dimensi memakai tipe yang sudah melekat pada state tanpa cast objek bebas.
- Parser Excel memakai `QuestionMetadata` dan `QuestionOptionMetadata`, memvalidasi array metadata opsional, menjaga nomor sumber, serta membentuk blank isian singkat tanpa ID palsu.
- Kontrak metadata soal menambahkan nomor sumber impor dan penanda PG kompleks yang memang digunakan parser.
- Parser DOCX menerima blank arsip lama yang belum mempunyai ID; ID tetap dibuat ketika soal disimpan.

## Route API dan helper

- Export backup memakai kontrak payload organisasi dan galat.
- Pemeriksaan ukuran entri ZIP membatasi cast hanya pada struktur internal JSZip yang diperlukan.
- Bulk import soal memakai record `unknown` terstruktur untuk teks soal dan opsi.
- Mobile navigation memakai `LucideIcon`.
- Cache memori menyimpan `unknown` lalu mengembalikan tipe generik pemanggil.
- Uploader memvalidasi bentuk respons upload sebelum membaca URL, provider, atau pesan galat.

## Hasil

Lint frontend berubah dari **41 error/0 warning** pada akhir Tahap 64 menjadi **0 error/0 warning**. Seluruh 1.804 masalah pada baseline awal telah diselesaikan tanpa pengecualian aturan baru.

## Verifikasi

- ESLint frontend penuh: **0 error/0 warning**.
- TypeScript frontend tanpa incremental cache: lulus.
- Build produksi Next.js: lulus; 92 halaman diproses.
- 30 regresi backup, PAS, idempotensi konten, sumber soal, dan kualitas UI: lulus.
- 44 pemeriksaan round-trip impor/ekspor soal: lulus.
- 13 pemeriksaan layanan bank soal: lulus.
- Pemeriksaan whitespace Git: lulus.

Build tetap mencatat peringatan migrasi konvensi Next.js dari `middleware` ke `proxy`; ini bukan kegagalan build atau lint, tetapi layak dijadikan tahap pemeliharaan terpisah.

## Tahap berikutnya

Lint tidak lagi menjadi penghalang. Prioritas berikutnya adalah validasi browser dan staging: ujian offline, antrean jawaban, submit setelah jaringan pulih, upload tugas, monitoring lintas perangkat, serta alur penilaian manual dengan database dan storage nyata.
