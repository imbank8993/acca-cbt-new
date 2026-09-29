# Tahap 56 — Kontrak jadwal dan ruangan PAS

Diperbarui 29 September 2026. Tahap ini melanjutkan target lint nol tanpa mematikan atau melonggarkan aturan.

## Masalah yang ditemukan

- API PAS mengembalikan mata pelajaran, kelas, staf, sesi, ruangan, pengawas, dan siswa sebagai `any[]`. Kesalahan nama bidang atau pemakaian ID yang keliru baru akan diketahui saat halaman dijalankan.
- Detail periode Admin ternyata memakai nama komponen dan kunci cache milik Proktor. Ketika pengguna berpindah peran pada sesi browser yang sama, data kelas, mata pelajaran, bank soal, atau sesi dari halaman Proktor dapat terbaca oleh halaman Admin.
- Pemuatan awal memanggil fungsi yang belum dideklarasikan dan effect tidak mencantumkan dependency sebenarnya. Refresh saat jendela kembali fokus dapat memakai nilai render lama.
- Jumlah siswa ruangan dibandingkan dengan kapasitas tanpa menangani relasi siswa yang belum disertakan oleh respons.

## Perbaikan kontrak data

- `PASPeriod` sekarang menyatakan daftar `pas_class_schedules` yang memang dipakai halaman detail.
- Jadwal kelas menyatakan relasi bank soal, termasuk kondisi bank sudah dihapus.
- API PAS mempunyai kontrak khusus untuk ringkasan mata pelajaran, staf dan perannya, ruangan, serta anggota ruangan.
- Daftar kelas memakai kontrak `OrganizationClass`, daftar siswa memakai `ClassStudent`, bank soal memakai `QuestionBank`, dan sesi memakai `PASSession`.
- Pengelompokan jadwal per tanggal dan waktu mempertahankan tipe `PASClassSchedule` sampai dirender.

## Perbaikan lifecycle dan pemisahan peran

- Pemuatan data detail dan modal ruangan memakai callback stabil.
- Pemuatan awal dijadwalkan dengan timer yang dibersihkan saat komponen ditutup.
- Listener fokus pada detail jadwal selalu memanggil callback terbaru dan dilepas saat halaman ditinggalkan.
- Callback asinkron dari impor massal dan penutupan modal ditandai secara eksplisit agar promise tidak diabaikan secara tidak sengaja.
- Cache Admin memakai awalan `admin_exams_pas__id__`, sedangkan Proktor tetap memakai `proktor_exams_pas__id__`.
- Implementasi Admin dan Proktor tetap setara untuk penjadwalan, pembuatan ujian, sesi, kapasitas ruangan, pengawas, dan penempatan siswa.

## Hasil

Lint frontend berubah dari **267 error/21 warning** pada akhir Tahap 55 menjadi **199 error/17 warning**. Tahap ini menghapus 72 masalah. Dibanding awal pembersihan lint, total turun dari 1.804 menjadi 216 masalah.

Sisa saat ini:

- 179 penggunaan `any`;
- 17 dependency hook;
- 14 pembaruan state langsung di effect;
- 4 pelanggaran immutability hook;
- 2 memoization yang tidak dapat dipertahankan compiler.

## Verifikasi

- TypeScript frontend: lulus.
- API PAS, detail jadwal Admin/Proktor, dan modal ruangan Admin/Proktor: lint nol.
- 33 pengujian PAS lulus, mencakup integritas ruangan, kapasitas, transaksi pengawas/siswa, sesi terkunci, jadwal massal, dan sinkronisasi ujian hasil generate.
- Pemeriksaan whitespace perubahan: lulus.
- ESLint frontend penuh: 199 error/17 warning.

## Tahap berikutnya

Bersihkan halaman analitik ujian Guru beserta kontrak API analitik. Kelompok ini merupakan sumber error terbesar berikutnya dan menyentuh keakuratan data laporan, filter, serta lifecycle pemuatan hasil.
