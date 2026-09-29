# Tahap 58 — Filter bersama dan rekap penilaian

Diperbarui 29 September 2026. Tahap ini melanjutkan target lint nol tanpa mematikan atau melonggarkan aturan.

## Filter bersama

- Anak komponen toolbar diperiksa melalui kontrak properti yang eksplisit sebelum membaca nilai, opsi, status centang, atau callback perubahan.
- Fragmen React dibuka sebagai elemen yang benar-benar memiliki `children`.
- Deteksi kolom pencarian dan aksi tidak lagi mengandalkan tipe komponen bebas.
- Kloning kolom pencarian mobile hanya menambahkan properti `placeholder` dan `trailing` yang didukung.
- Pilihan tunggal pada modal hanya dibentuk setelah opsi, nilai, dan callback lolos pemeriksaan.
- Filter bulan menyatakan hasil berupa teks bulan atau daftar nomor bulan untuk menjaga kompatibilitas dua bentuk pemakaian.

## Rekap penilaian Guru

- Daftar ujian memakai `OrganizationExam` dan daftar attempt memakai `ExamAttemptRecord`.
- Profil attempt mencakup email yang memang dipakai ekspor rekap.
- Analisis butir mempunyai kontrak lokal untuk nomor, teks, jumlah jawaban, benar, salah, dan persentase kesalahan.
- Jawaban serta soal dari API analisis diproses tanpa cast array bebas.
- Pemuatan awal dan pergantian ujian memakai callback stabil serta timer yang dibersihkan.
- Kondisi tanpa ujian membersihkan rekap dan analisis melalui callback timer, sehingga tidak memperbarui state langsung di effect.

## Hasil

Lint frontend berubah dari **176 error/16 warning** pada akhir Tahap 57 menjadi **155 error/14 warning**. Tahap ini menghapus 23 masalah. Dibanding awal pembersihan lint, total turun dari 1.804 menjadi 169 masalah.

Sisa saat ini:

- 137 penggunaan `any`;
- 14 dependency hook;
- 12 pembaruan state langsung di effect;
- 4 pelanggaran immutability hook;
- 2 memoization yang tidak dapat dipertahankan compiler.

## Verifikasi

- TypeScript frontend: lulus.
- Toolbar filter, rekap penilaian Guru, dan kontrak API Proktor yang disentuh: lint nol.
- 3 regresi penilaian esai dan perhitungan ulang skor: lulus.
- ESLint frontend penuh: 155 error/14 warning.

## Tahap berikutnya

Bersihkan komponen matching interaktif dan formatter jawaban bersama karena keduanya menangani bentuk jawaban kompleks dan kini menjadi sumber `any` terbesar.
