# Tahap 61 — Analitik dan dashboard Siswa

Diperbarui 29 September 2026. Tahap ini melanjutkan target lint nol tanpa mematikan atau melonggarkan aturan.

## Analitik Siswa

- Riwayat ujian memakai `StudentExamHistoryItem` dan perbandingan kelas memakai `StudentComparison`.
- State pengguna, nama lengkap, dan rentang waktu kosong yang tidak pernah dirender telah dihapus.
- Opsi grafik tren dan mata pelajaran memakai `ChartOptions<'line'>` serta `ChartOptions<'bar'>`.
- Callback label sumbu grafik menerima tipe nilai dari Chart.js, bukan objek bebas.
- Pemuatan awal dan refresh saat jendela kembali fokus memakai callback stabil, timer, serta cleanup listener.

## Dashboard Siswa

- Daftar ujian memakai `StudentScheduledExam`, sedangkan riwayat hasil memakai `StudentResult`.
- Pengumuman memakai kontrak `Announcement` dan isi kosong dinormalisasi sebelum melewati formatter tautan aman.
- State pengguna dan nama lengkap yang tidak digunakan telah dihapus.
- Kartu ujian menerima kontrak jadwal siswa sehingga waktu, durasi, status, serta status selesai tidak dibaca dari objek bebas.
- Pemuatan awal memakai timer dengan cleanup, sedangkan auto-refresh memakai callback yang menyatakan seluruh dependency cache.

## Hasil

Lint frontend berubah dari **116 error/11 warning** pada akhir Tahap 60 menjadi **103 error/9 warning**. Tahap ini menghapus 15 masalah. Dibanding awal pembersihan lint, total turun dari 1.804 menjadi 112 masalah.

Sisa saat ini:

- 89 penggunaan `any`;
- 9 dependency hook;
- 8 pembaruan state langsung di effect;
- 4 pelanggaran immutability hook;
- 2 memoization yang tidak dapat dipertahankan compiler.

## Verifikasi

- TypeScript frontend: lulus.
- Analitik Siswa, dashboard Siswa, dan kontrak API analitik: lint nol.
- 6 regresi tren analitik dan status jadwal siswa: lulus.
- ESLint frontend penuh: 103 error/9 warning.

## Tahap berikutnya

Bersihkan toolbar input kaya, kemudian detail penilaian Guru. Toolbar diprioritaskan karena dipakai oleh banyak editor soal dan perubahan di sana harus tervalidasi sebelum menyentuh halaman penilaian.
