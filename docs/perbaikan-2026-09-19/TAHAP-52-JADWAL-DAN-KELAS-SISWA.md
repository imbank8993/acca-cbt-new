# Tahap 52 — Jadwal dan kelas siswa

Diperbarui 28 September 2026. Tahap ini melanjutkan target lint nol tanpa mematikan atau melonggarkan aturan.

## Perbaikan

- Halaman jadwal memakai kontrak ujian siswa untuk status publikasi, waktu mulai/akhir, durasi, status selesai, dan status sedang dikerjakan.
- Perhitungan ujian tersedia, akan datang, dan selesai tidak lagi menerima objek tanpa tipe.
- Pemuatan awal jadwal dijadwalkan dengan cleanup, sementara pembaruan jam tetap dibersihkan saat halaman ditutup.
- Halaman kelas memakai kontrak kelas siswa untuk identitas, program, dan jenis kelas.
- Pemuatan kelas dideklarasikan sebagai callback stabil sebelum dipakai effect. Refresh saat jendela kembali fokus memakai handler yang dibersihkan dengan benar.
- Refresh setelah bergabung atau keluar kelas dijalankan tanpa mengabaikan promise secara implisit.

## Hasil

Lint frontend berubah dari **358 error/25 warning** pada akhir Tahap 51 menjadi **352 error/24 warning**. Tahap ini menghapus 7 masalah. Dibanding awal pembersihan lint, total turun dari 1.804 menjadi 376 masalah.

Sisa saat ini:

- 325 penggunaan `any`;
- 24 dependency hook;
- 14 pembaruan state langsung di effect;
- 11 pelanggaran immutability hook;
- 2 memoization yang tidak dapat dipertahankan compiler.

## Verifikasi

- TypeScript frontend: lulus.
- Halaman jadwal dan kelas siswa: lint nol.
- ESLint frontend penuh: 352 error/24 warning.

## Tahap berikutnya

Bersihkan parser dokumen impor karena merupakan satu berkas dengan temuan `any` terbanyak. Sesudah parser memiliki batas data yang jelas, lanjutkan komponen impor massal dan halaman kelas Admin, Guru, serta Proktor.
