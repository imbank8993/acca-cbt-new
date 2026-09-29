# Tahap 60 — Dashboard Guru, Admin, dan Proktor

Diperbarui 29 September 2026. Tahap ini melanjutkan target lint nol tanpa mematikan atau melonggarkan aturan.

## Kontrak data dashboard

- Organisasi memakai `ProctorOrganization` dan statistik sekolah memakai `OrganizationStats` atau `GuruStats`.
- Daftar ujian memakai `OrganizationExam`, termasuk nama pembuat yang ditampilkan pada kartu ujian.
- Login terbaru dan daftar anggota memakai `RecentLogin` dengan type guard yang mewajibkan waktu login sebelum data dirender.
- Pengumuman mempunyai bidang ID, judul, isi, dan waktu pembuatan yang eksplisit. Isi kosong dinormalisasi sebelum melewati formatter tautan aman.
- Daftar ujian Guru menyaring PAS/PAT tanpa cast objek bebas.

## Lifecycle dan pemisahan peran

- Cache statistik, ujian, login, loading, dan pengumuman tetap terpisah untuk Guru, Admin, serta Proktor.
- Callback pemuatan menyatakan seluruh setter cache sebagai dependency.
- Pemuatan awal dijadwalkan melalui timer dan timer dibersihkan ketika halaman dilepas.
- Auto-refresh tetap memakai callback terbaru.
- Properti `orgId` lama pada kartu login dihapus karena sumber login sekarang sudah dibatasi oleh sesi backend dan properti tersebut tidak pernah dibaca.
- Implementasi Admin dan Proktor tetap setara, dengan rute serta kunci cache masing-masing.

## Hasil

Lint frontend berubah dari **138 error/14 warning** pada akhir Tahap 59 menjadi **116 error/11 warning**. Tahap ini menghapus 25 masalah. Dibanding awal pembersihan lint, total turun dari 1.804 menjadi 127 masalah.

Sisa saat ini:

- 101 penggunaan `any`;
- 11 dependency hook;
- 9 pembaruan state langsung di effect;
- 4 pelanggaran immutability hook;
- 2 memoization yang tidak dapat dipertahankan compiler.

## Verifikasi

- TypeScript frontend: lulus.
- Dashboard Guru, Admin, Proktor serta kontrak API yang disentuh: lint nol.
- 8 regresi kesetaraan halaman peran dan konteks satu sekolah: lulus.
- ESLint frontend penuh: 116 error/11 warning.

## Tahap berikutnya

Bersihkan analitik dan dashboard Siswa, kemudian toolbar input kaya. Analitik Siswa diprioritaskan karena merupakan kelompok temuan terbesar berikutnya dan memengaruhi angka yang dilihat peserta.
