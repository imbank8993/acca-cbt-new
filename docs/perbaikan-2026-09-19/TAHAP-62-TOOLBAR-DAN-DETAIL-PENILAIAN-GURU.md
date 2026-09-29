# Tahap 62 — Toolbar dan detail penilaian Guru

Diperbarui 29 September 2026. Tahap ini melanjutkan target lint nol tanpa mematikan atau melonggarkan aturan.

## Toolbar input kaya

- Referensi editor Quill sekarang memakai kontrak untuk seleksi, pemformatan, penyisipan teks, dan penempelan HTML.
- Nilai format diperlakukan sebagai `unknown`, sehingga setiap pemanggil harus mengirim nilai yang memang didukung editor.
- Callback pembaca editor yang ditolak React Compiler dihapus. Setiap aksi membaca editor aktif langsung dari referensi bersama.
- Pergantian fokus antara editor soal dan editor opsi tetap memakai provider yang sama.

## Kontrak detail penilaian

- API Guru sekarang mempunyai kontrak untuk attempt, profil siswa, ujian, soal esai, opsi topik, nilai, dan jawaban.
- Jawaban teks lama, JSON, serta objek dinormalisasi oleh satu parser. Hanya teks dan daftar URL bertipe string yang diteruskan ke antarmuka.
- Halaman penilaian biasa dan reviewer tugas memakai parser yang sama untuk teks, lampiran, video, dan topik.
- Daftar jawaban reviewer dibuat tanpa mengubah objek balasan API.

## Cacat fungsi yang diperbaiki

- Halaman penilaian sebelumnya menimpa `question_text` yang benar dengan properti lama `question` yang tidak lagi dikirim server. Akibatnya isi soal dapat kosong. Renderer sekarang menerima `question_text` dari kontrak aktif.
- Server sekarang menyertakan `finished_at`, sehingga reviewer menampilkan waktu pengumpulan yang sebenarnya dan tidak selalu menulis “Belum Selesai”.
- Lampiran dari JSON yang rusak atau berisi nilai selain string tidak lagi langsung dipakai sebagai `href`, `src`, atau sumber iframe.
- State kosong untuk catatan Guru yang belum pernah digunakan telah dihapus.

## Hasil

Lint frontend berubah dari **103 error/9 warning** pada akhir Tahap 61 menjadi **84 error/8 warning**. Tahap ini menghapus 20 masalah. Dibanding awal pembersihan lint, total turun dari 1.804 menjadi 92 masalah.

Sisa saat ini:

- 70 penggunaan `any`;
- 10 pembaruan state langsung di effect;
- 8 dependency hook;
- 4 pelanggaran immutability hook.

## Verifikasi

- TypeScript frontend: lulus.
- Build backend NestJS: lulus.
- Toolbar, dua halaman detail penilaian, dan kontrak API Guru: lint nol.
- 13 regresi penilaian dan penugasan ujian: lulus.
- Pemeriksaan whitespace Git: lulus.
- ESLint frontend penuh: 84 error/8 warning.

## Tahap berikutnya

Bersihkan komponen dengan pelanggaran hook lebih dahulu, terutama pembaruan state di effect dan dependency yang belum lengkap. Setelah lifecycle stabil, lanjutkan sisa `any` berdasarkan kelompok halaman.
