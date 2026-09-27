# Tahap 29 — Integritas pembangkitan ujian massal

Diperbarui 27 September 2026. Tahap ini melindungi pembangkitan ujian dari jadwal PAS/PAT dan konfigurasi ujian terhadap retry, permintaan bersamaan, kegagalan sebagian, relasi yang tidak konsisten, dan waktu ujian yang tidak valid.

## Temuan

Sebelumnya setiap jadwal dibangkitkan melalui tiga operasi database terpisah:

1. membuat baris `cbt_exams`;
2. menulis `exam_id` kembali ke jadwal;
3. membuat target kelas pada `cbt_exam_targets`.

Tidak ada transaksi yang menyatukan ketiganya. Bila pembuatan ujian berhasil tetapi penautan jadwal atau target kelas gagal, ujian tertinggal tanpa hubungan yang lengkap. Retry kemudian melihat `exam_id` masih kosong dan membuat ujian kedua.

Dua permintaan yang datang hampir bersamaan juga dapat sama-sama membaca `exam_id` kosong sebelum salah satunya memperbarui jadwal. Keduanya lalu membuat ujian untuk jadwal yang sama.

Daftar ID yang sama dapat memuat satu ID lebih dari sekali. Selain itu, validasi pembuatan jadwal belum memastikan seluruh relasi berasal dari induk yang benar:

- sesi PAS dapat berasal dari periode lain;
- bank soal atau kelas dapat berasal dari sekolah lain;
- jadwal konfigurasi dapat menunjuk baris bank dari konfigurasi lain;
- kelas konfigurasi dapat berasal dari sekolah lain.

Generator juga menerima tanggal atau jam kosong dan jendela dengan waktu selesai yang tidak setelah waktu mulai. Hasilnya dapat berupa ujian tanpa batas waktu yang sah.

## Perbaikan transaksi dan retry

Setiap jadwal kini diproses dalam transaksi database tersendiri. Transaksi mengambil advisory lock berdasarkan jenis sumber dan ID jadwal. Permintaan kedua untuk sumber yang sama menunggu transaksi pertama, lalu membaca `exam_id` yang sudah terpasang dan melewati pembuatan.

Ujian memakai UUID deterministik yang diturunkan dari ID jadwal dan namespace berbeda untuk PAS dan konfigurasi. UUID itu disimpan pada kolom idempotensi `cbt_exams` yang telah diterapkan permanen pada Tahap 26. Dengan demikian, pemulihan terhadap respons yang hilang tetap menunjuk ujian yang sama.

Di dalam transaksi, urutannya sekarang:

1. kunci sumber pembangkitan;
2. baca ulang jadwal;
3. validasi periode atau konfigurasi, bank soal, kelas, dan waktu;
4. buat atau ambil ujian dengan kunci stabil;
5. pastikan target kelas tersedia;
6. tautkan ID ujian ke jadwal;
7. commit seluruh perubahan bersama-sama.

Setiap kegagalan baca atau tulis target dan tautan kini diperiksa. Bila salah satunya gagal, ujian, target, dan perubahan jadwal di-rollback. Batch tetap memproses jadwal lain dan mengembalikan alasan kegagalan per ID.

ID ganda dalam satu request dihapus sebelum pemrosesan sehingga satu jadwal hanya dihitung satu kali.

## Perbaikan relasi dan waktu

Saat menambah jadwal PAS, server memastikan:

- sesi berada pada periode yang dipilih;
- bank soal berada pada sekolah periode;
- kelas berada pada sekolah periode;
- jam akhir sesi setelah jam mulai.

Saat menambah bank atau jadwal konfigurasi, server memastikan:

- bank soal berada pada sekolah konfigurasi;
- baris bank memang berada di konfigurasi yang dipilih;
- kelas berada pada sekolah konfigurasi.

Validasi diulang saat pembangkitan untuk melindungi data lama yang mungkin sudah tidak konsisten. Ujian tidak dibuat bila tanggal/jam kosong atau waktu selesai tidak setelah waktu mulai.

## Perilaku jaringan dan UI

Pembangkitan batch dapat memerlukan waktu lebih lama dari mutasi biasa. Browser sekarang menunggu sampai 120 detik pada kedua endpoint pembangkitan. Jika jaringan terputus atau respons tetap hilang, pengguna dapat mengulang operasi; kunci sumber dan UUID deterministik mencegah ujian ganda.

Respons tetap berisi `created` dan `skipped`. Jadwal yang gagal tidak membatalkan jadwal lain, tetapi satu jadwal tidak pernah tersimpan setengah jadi.

## Migrasi dan rollout

Tahap ini tidak memerlukan migrasi baru. Perlindungan memakai kolom `client_request_id`, `client_request_hash`, dan indeks unik `cbt_exams_client_request_unique` dari migrasi Tahap 26 yang sudah diterapkan permanen ke `acca_db`.

## Verifikasi

Tujuh tes `GEN-01` sampai `GEN-07` membuktikan:

- retry PAS tidak menggandakan ujian atau target;
- ID duplikat dalam satu batch hanya diproses sekali;
- kegagalan penautan PAS membatalkan ujian dan target;
- retry konfigurasi tidak menggandakan ujian atau target;
- kegagalan target konfigurasi membatalkan ujian;
- kedua generator memakai transaksi, advisory lock, dan UUID sumber stabil;
- relasi induk/sekolah divalidasi;
- browser memakai timeout batch 120 detik;
- jendela waktu tidak valid ditolak.

Hasil akhir:

- 7 tes Tahap 29: lulus;
- 186 tes regresi Node dalam 28 berkas: lulus;
- typecheck frontend: lulus;
- build shared dan backend: lulus.

## Batas lanjutan

Tes menggunakan fixture transaksi yang meniru rollback dan pencatatan mutasi. Pengujian staging dengan dua request HTTP bersamaan pada PostgreSQL nyata tetap diperlukan untuk mengukur waktu tunggu lock dan perilaku reverse proxy.

Penghapusan jadwal beserta ujian serta penggantian massal peserta/pengawas ruang masih perlu diaudit sebagai rangkaian operasi lintas tabel. Area itu menjadi kandidat tahap berikutnya karena kegagalan di tengah penggantian daftar dapat meninggalkan penugasan ruang tidak lengkap.

## Berkas utama

- `apps/api/src/pas/pas-schedules.service.ts`
- `apps/api/src/exam-configs/exam-configs.service.ts`
- `apps/web/lib/api/pas.ts`
- `apps/web/lib/api/exam-configs.ts`
- `apps/api/test/exam-generation-stage29.test.cjs`
- `database/migrations/20260927_01_idempotent_creates.sql`
