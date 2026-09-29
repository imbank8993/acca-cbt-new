# Tahap 57 — Analitik ujian Guru

Diperbarui 29 September 2026. Tahap ini melanjutkan target lint nol tanpa mematikan atau melonggarkan aturan.

## Perbaikan

- API analitik mempunyai kontrak eksplisit untuk daftar ujian dan statistiknya, attempt, profil siswa, jawaban, soal, opsi, respons per soal, serta data ekspor.
- Review jawaban siswa membedakan nama bidang dari database (`question_id`, `selected_option_id`) dan bentuk tampilan API (`questionId`, `selectedOptionId`).
- Ekspor ringkasan, detail jawaban, dan referensi soal tidak lagi membaca objek bebas. Kolom dinamis lembar jawaban dibatasi ke teks atau angka.
- Distribusi opsi dan daftar respons peserta memakai kontrak yang sama dengan formatter jawaban.
- Detail respons soal hanya disimpan ketika server benar-benar mengembalikan data, sehingga nilai kosong tidak dibaca sebagai objek.
- Effect pemuatan analitik menyatakan dependency cache yang dipakai agar tidak mempertahankan setter dari render lama.

## Hasil

Lint frontend berubah dari **199 error/17 warning** pada akhir Tahap 56 menjadi **176 error/16 warning**. Tahap ini menghapus 24 masalah. Dibanding awal pembersihan lint, total turun dari 1.804 menjadi 192 masalah.

Sisa saat ini:

- 156 penggunaan `any`;
- 16 dependency hook;
- 14 pembaruan state langsung di effect;
- 4 pelanggaran immutability hook;
- 2 memoization yang tidak dapat dipertahankan compiler.

## Verifikasi

- TypeScript frontend: lulus.
- API analitik dan halaman detail analitik ujian Guru: lint nol.
- 3 regresi perhitungan tren analitik: lulus.
- ESLint frontend penuh: 176 error/16 warning.

## Tahap berikutnya

Bersihkan toolbar filter bersama, kemudian alur penilaian Guru. Toolbar diprioritaskan karena dipakai lintas halaman; kontrak penilaian menyusul karena berhubungan langsung dengan skor dan status koreksi manual.
