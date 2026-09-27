# Tahap 34 — Pemulihan peserta terpilih per kelas

Diperbarui 27 September 2026. Tahap ini memastikan modal penugasan ujian dapat dibuka, disimpan, lalu dibuka kembali tanpa memindahkan peserta ke kelas lain.

## Temuan

Mode **siswa terpilih** sebelumnya hanya menyimpan `exam_id` dan `user_id` pada `cbt_exam_participants`. ID kelas tempat siswa dipilih dibuang sebelum request dikirim ke server.

Ketika modal dibuka kembali, server mencoba menebak kelas peserta dari `cbt_class_members` dan mengambil baris pertama tanpa urutan. Siswa dapat mempunyai kelas aktif lebih dari satu atau riwayat kelas lama. Karena itu hasil tebakan tidak deterministik dan dapat menempatkan siswa pada kelas yang salah.

Dampaknya meliputi jumlah peserta per kelas yang keliru, pilihan yang berpindah setelah modal dibuka kembali, serta peserta yang hilang ketika keadaan hasil tebakan disimpan ulang.

## Perbaikan kontrak dan database

Browser sekarang mengirim pasangan `{ userId, classId }` untuk setiap peserta terpilih. Ketiga halaman Admin, Guru, dan Proktor memakai kontrak yang sama.

Migrasi `20260927_06_exam_participant_class_source.sql` menambahkan:

- `regular_class_id`, dengan foreign key ke `cbt_classes`;
- `additional_class_id`, dengan foreign key ke `cbt_additional_classes`;
- check constraint agar satu peserta tidak mempunyai dua jenis kelas sumber sekaligus;
- indeks parsial untuk kedua kolom sumber.

Foreign key memakai `ON DELETE SET NULL`. Jika kelas suatu hari dihapus, kepesertaan ujian tidak ikut hilang dan akses peserta tetap dipertahankan, tetapi asal kelasnya menjadi kosong.

## Validasi server

Sebelum penugasan lama dihapus, server memastikan:

- setiap pasangan peserta–kelas benar-benar mempunyai baris keanggotaan;
- peserta merupakan anggota aktif sekolah ujian;
- kelas sumber berasal dari sekolah dan tahun ajaran yang sah;
- satu siswa tidak dipilih dari dua kelas berbeda pada ujian yang sama;
- kelas sumber disimpan pada kolom reguler atau tambahan yang benar.

Pembacaan modal tidak lagi menebak dari urutan keanggotaan. Server langsung mengembalikan kelas sumber yang disimpan bersama peserta.

## Audit dan migrasi permanen

Sebelum migrasi, `acca_db` mempunyai nol baris `cbt_exam_participants`. Karena tidak ada peserta legacy, tidak diperlukan backfill atau keputusan kelas yang ambigu.

Dry run seluruh 13 migrasi berhasil, termasuk pengulangan idempoten. Migrasi Tahap 34 kemudian diterapkan permanen ke `acca_db` dan diverifikasi melalui koneksi baru.

Audit yang sama menemukan tiga migrasi perlindungan lama belum terpasang. Atas permintaan pengguna, migrasi attempt aktif, heartbeat/deduplikasi event, dan single-school juga diterapkan permanen. Audit ulang menghasilkan nol blocker dan nol warning.

## Verifikasi

Lima tes `RESTORE-01` sampai `RESTORE-05` membuktikan:

- kelas sumber tersimpan mengalahkan urutan riwayat keanggotaan;
- sumber kelas tambahan dipulihkan tepat;
- pasangan peserta–kelas palsu ditolak sebelum delete;
- Admin, Guru, dan Proktor mengirim pasangan siswa–kelas;
- migrasi mempunyai kedua foreign key dan check constraint.

Hasil akhir:

- 5 tes Tahap 34: lulus;
- seluruh 221 tes regresi Node dalam 33 berkas: lulus;
- typecheck frontend: lulus;
- build backend: lulus;
- dry run 13 migrasi: lulus;
- migrasi Tahap 34 dan tiga migrasi perlindungan lama: diterapkan permanen;
- audit database setelah commit: tanpa blocker dan tanpa warning.

## Berkas utama

- `apps/api/src/proctor/dto/proctor.dto.ts`
- `apps/api/src/proctor/proctor.controller.ts`
- `apps/api/src/proctor/exam-admin.service.ts`
- `apps/web/lib/api/proctor.ts`
- `apps/web/app/dashboard/admin/exams/page.tsx`
- `apps/web/app/dashboard/guru/exams/page.tsx`
- `apps/web/app/dashboard/proktor/exams/page.tsx`
- `database/migrations/20260927_06_exam_participant_class_source.sql`
- `apps/api/test/exam-assignment-restore-stage34.test.cjs`
