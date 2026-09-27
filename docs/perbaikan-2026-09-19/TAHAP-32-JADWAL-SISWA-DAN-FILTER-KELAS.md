# Tahap 32 — Jadwal siswa dan filter banyak kelas

Diperbarui 27 September 2026. Tahap ini memperbaiki kegagalan halaman **Jadwal Ujian** siswa dengan pesan “Penugasan ujian belum dapat diperiksa. Coba lagi.”

## Gejala

Halaman jadwal dapat terbuka, tetapi seluruh kartu ringkasan menampilkan angka nol dan daftar diganti kartu galat. Angka nol tersebut bukan hasil pembacaan database; angka itu berasal dari nilai awal array kosong ketika permintaan jadwal gagal.

## Penyebab utama

Sumber penugasan ujian menggabungkan kelas reguler dan kelas tambahan dengan filter PostgREST berbentuk:

```text
class_id.in.(id-kelas-1,id-kelas-2),additional_class_id.in.(id-kelas-tambahan)
```

Adapter PostgreSQL internal sebelumnya memecah seluruh ekspresi memakai `split(',')`. Koma di dalam `in.(...)` ikut dianggap sebagai pemisah cabang. Untuk siswa yang tercatat pada lebih dari satu kelas, nilai pertama berubah menjadi teks seperti `(id-kelas-1` dan PostgreSQL menolaknya sebagai UUID tidak valid. `loadExamAudience()` sengaja gagal tertutup demi keamanan, lalu mengembalikan pesan penugasan tidak dapat diperiksa.

Audit baca-saja pada `acca_db` memastikan tabel dan kolom yang dibutuhkan tersedia. Saat audit dilakukan terdapat 667 keanggotaan kelas reguler, 8 target ujian reguler, dan contoh siswa dengan 8 riwayat keanggotaan kelas. Kondisi banyak kelas inilah yang membuka bug parser. Audit tidak mengubah data siswa.

## Perbaikan

Parser OR sekarang memisahkan koma hanya pada tingkat terluar. Kedalaman tanda kurung, tanda kutip, dan karakter escape dilacak, sehingga seluruh ID pada `in.(...)` tetap utuh dan diikat sebagai parameter UUID terpisah.

Tampilan jadwal juga diperbaiki:

- ketika pembacaan gagal, kartu ringkasan menampilkan `—`, bukan angka nol palsu;
- kartu `Draft` diganti `Total Jadwal`, karena API siswa hanya mengirim ujian yang sudah dipublikasikan;
- ujian masa depan tidak lagi masuk kategori `Tersedia` dan `Akan Datang` sekaligus;
- ujian hanya dapat tampil sebagai tersedia setelah waktu mulai tiba.

## Keamanan dan data

Kebijakan gagal tertutup tetap dipertahankan. Jika sumber organisasi, kelas, peserta, atau target benar-benar gagal dibaca, aplikasi tidak membuka ujian privat secara otomatis.

Perbaikan ini tidak mengubah tabel, keanggotaan kelas, target ujian, attempt, ataupun jawaban siswa. Tidak ada migrasi database pada tahap ini.

## Verifikasi

Tiga tes `SCHEDULE-01` sampai `SCHEDULE-03` membuktikan:

- koma dalam daftar beberapa kelas tidak memecah cabang OR;
- ketiga ID contoh tetap diikat utuh sebagai UUID pada SQL;
- halaman mensyaratkan waktu mulai untuk status tersedia dan tidak menampilkan nol saat galat.

Tes keamanan siswa yang sudah ada juga dijalankan kembali untuk memastikan ujian perorangan, kelas reguler, kelas tambahan, sekolah asing, draft, dan ujian privat tetap mengikuti aturan akses.

Hasil:

- 3 tes Tahap 32: lulus;
- 36 tes keamanan dan akses siswa: lulus;
- seluruh 211 tes regresi Node dalam 31 berkas: lulus;
- typecheck frontend: lulus;
- build backend: lulus;
- `git diff --check`: lulus;
- migrasi database: tidak diperlukan.

Kontrol browser lokal tidak dapat dijalankan dari sesi Codex ini karena helper UI gagal mulai akibat konfigurasi izin workspace. Pemeriksaan tampilan dilakukan melalui typecheck dan kontrak komponen; pemuatan ulang di browser pengguna tetap menjadi pemeriksaan akhir yang paling langsung.

## Berkas utama

- `apps/api/src/prisma/prisma-db-adapter.ts`
- `apps/web/app/dashboard/siswa/schedule/page.tsx`
- `apps/api/test/student-schedule-stage32.test.cjs`
