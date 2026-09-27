# Tahap 37 — Katalog mata pelajaran operasional

Diperbarui 28 September 2026. Tahap ini menyatukan ID mata pelajaran yang ditampilkan di browser dengan foreign key UUID yang disimpan oleh CBT.

## Temuan

Dropdown PAS dan konfigurasi ujian membaca `master_mapel.id` bertipe `bigint`. Nilai dari `<select>` kemudian dikirim sebagai `subject_id`, tetapi DTO mengharuskan UUID dan database mereferensikan `cbt_subjects(id)` bertipe UUID.

Database aktif mempunyai 41 `master_mapel` aktif dan 0 baris `cbt_subjects`. Akibatnya, pengguna dapat melihat 41 pilihan mapel tetapi penyimpanan jadwal PAS atau bank konfigurasi selalu berpotensi ditolak sebelum mencapai database.

## Perbaikan

`master_mapel` tetap menjadi sumber nama, kode, kelompok, dan status aktif. Helper katalog bersama menyelaraskannya ke `cbt_subjects` per sekolah dan mengembalikan UUID operasional kepada browser.

Pemetaan `(organization_id, master_mapel_id)` bersifat unik. Sinkronisasi berikutnya memperbarui nama, kode, warna, serta status tanpa mengganti UUID. Mapel nonaktif tetap disimpan agar riwayat ujian lama tidak kehilangan referensi, tetapi tidak ditampilkan untuk penjadwalan baru.

Endpoint PAS dan Proktor sekarang memakai helper yang sama. Karena halaman Admin, Guru, dan Proktor mengambil pilihan melalui endpoint tersebut, seluruh dropdown menerima kontrak UUID yang sama tanpa perubahan format formulir.

Saat jadwal PAS atau bank konfigurasi disimpan, server memastikan UUID mapel aktif berasal dari sekolah yang sama. ID lintas sekolah, tidak dikenal, atau nonaktif ditolak sebelum insert.

## Migrasi dan database aktif

Migrasi `20260927_08_subject_catalog_bridge.sql` menambahkan `master_mapel_id`, `is_active`, indeks unik pemetaan, dan indeks katalog aktif. Migrasi juga mengisi katalog awal dari seluruh master mapel.

Migrasi diterapkan permanen ke `acca_db`. Verifikasi koneksi baru menghasilkan:

- master mapel total: 41;
- master mapel aktif: 41;
- mapel operasional terpetakan: 41;
- mapel operasional aktif: 41;
- master aktif tanpa UUID: 0;
- perbedaan nama, kode, atau status: 0.

Audit lifecycle akhir menghasilkan 0 blocker dan 0 warning.

## Verifikasi

Tujuh tes `SUBJECT-01` sampai `SUBJECT-07` mencakup pemetaan ID, kestabilan UUID, sinkronisasi perubahan master, status nonaktif, isolasi sekolah, kontrak DTO, migrasi, jadwal PAS, dan konfigurasi ujian.

Seluruh 15 migrasi lulus dry run dan pengulangan idempoten.

Regresi lengkap menghasilkan 245 tes Node pada 36 berkas tanpa kegagalan. Pemeriksaan TypeScript frontend dan build produksi backend juga lulus.

## Berkas utama

- `apps/api/src/common/subject-catalog.ts`
- `apps/api/src/pas/pas.service.ts`
- `apps/api/src/pas/pas-schedules.service.ts`
- `apps/api/src/proctor/proctor.service.ts`
- `apps/api/src/exam-configs/exam-configs.service.ts`
- `database/migrations/20260927_08_subject_catalog_bridge.sql`
- `apps/api/test/subject-catalog-stage37.test.cjs`
