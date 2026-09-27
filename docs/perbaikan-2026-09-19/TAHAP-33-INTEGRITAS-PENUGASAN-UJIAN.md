# Tahap 33 — Integritas penugasan ujian

Diperbarui 27 September 2026. Tahap ini mengamankan proses yang mengganti kelas dan peserta perorangan sebuah ujian, karena hasil proses tersebut menjadi sumber utama halaman jadwal siswa.

## Temuan

Jalur lama menghapus seluruh `cbt_exam_targets` dan `cbt_exam_participants` lebih dulu, kemudian baru mencoba membaca serta memasukkan target baru. Operasi tersebut tidak berada dalam transaksi.

Akibatnya:

- ID kelas yang salah dapat diketahui setelah target lama telanjur dihapus;
- kelas yang tidak ditemukan di tabel reguler otomatis dianggap kelas tambahan;
- kelas dari sekolah lain tidak ditolak secara eksplisit;
- kelas reguler dari tahun ajaran lama masih dapat dikirim langsung ke API;
- peserta nonaktif atau dari sekolah lain tidak divalidasi;
- kegagalan insert peserta dapat meninggalkan target kelas baru tanpa peserta;
- kegagalan pengaktifan ujian tidak diperiksa;
- dua browser yang menyimpan penugasan bersamaan dapat saling menyalip.

## Perbaikan

Penggantian penugasan sekarang menjalankan urutan berikut dalam satu transaksi:

1. menghapus ID kelas dan peserta yang duplikat dari payload;
2. mengunci baris ujian dengan `FOR UPDATE`;
3. membaca sekolah pemilik ujian;
4. memastikan setiap kelas benar-benar ada pada tabel reguler atau tambahan;
5. memastikan kelas berasal dari sekolah ujian;
6. memastikan kelas reguler berada pada tahun ajaran aktif;
7. memastikan peserta merupakan anggota aktif sekolah ujian;
8. menghapus target lama;
9. memasukkan target baru dan, bila diminta, mengaktifkan ujian;
10. melakukan rollback seluruh perubahan jika salah satu langkah gagal.

ID yang tidak ditemukan tidak lagi diasumsikan sebagai kelas tambahan. Jumlah kelas dan peserta pada respons memakai jumlah unik yang benar-benar disimpan.

## Audit data nyata

Audit baca-saja menemukan dua tahun ajaran aktif, 523 keanggotaan kelas aktif, dan 144 keanggotaan historis. Tidak ditemukan target ujian pada kelas historis, termasuk target historis yang masih dipublikasikan dan belum berakhir. Karena itu tidak diperlukan pembersihan data.

Audit tidak membaca nama atau identitas siswa dan tidak mengubah database.

## Verifikasi

Lima tes `ASSIGN-01` sampai `ASSIGN-05` membuktikan:

- target valid menggantikan target lama secara atomik;
- ID ganda hanya menghasilkan satu baris;
- penguncian ujian dijalankan;
- kelas tidak dikenal, sekolah lain, dan tahun lama ditolak sebelum delete;
- peserta nonaktif ditolak sebelum delete;
- kegagalan insert peserta mengembalikan target, peserta, dan status ujian lama.

Hasil akhir:

- 5 tes Tahap 33: lulus;
- seluruh 216 tes regresi Node dalam 32 berkas: lulus;
- typecheck frontend: lulus;
- build backend: lulus;
- build produksi frontend: lulus;
- `git diff --check`: lulus;
- migrasi database: tidak diperlukan.

Build frontend mula-mula tidak dapat mengambil Google Fonts karena jaringan sandbox. Setelah build diberi akses jaringan, kompilasi dan seluruh 92 halaman selesai. Pesan route dinamis saat pengumpulan page data bersifat informasional; build berakhir sukses.

## Berkas utama

- `apps/api/src/proctor/exam-admin.service.ts`
- `apps/api/test/exam-assignment-stage33.test.cjs`
- `package.json`
