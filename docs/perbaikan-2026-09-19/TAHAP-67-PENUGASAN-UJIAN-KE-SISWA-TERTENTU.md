# Tahap 67 — Penugasan ujian ke siswa tertentu

Diperbarui 29 September 2026. Tahap ini memperbaiki respons umum “Terjadi kesalahan pada server. Silakan coba lagi.” ketika Admin, Guru, atau Proktor menetapkan ujian kepada siswa tertentu.

## Penyebab

Penugasan berjalan dalam transaksi dan mengunci baris ujian sebelum memvalidasi kelas serta peserta. Adapter transaksi menerima parameter SQL dalam bentuk variadik, tetapi ID ujian dikirim sebagai array satu elemen. Prisma kemudian mencoba memasukkan array ke placeholder `$1::uuid` dan melempar galat mentah sebelum validasi penugasan dijalankan.

Karena galat tersebut bukan `HttpException`, filter keamanan sengaja tidak mengirim detail Prisma/SQL ke browser dan menggantinya dengan pesan umum. Dengan demikian, pesan pada layar bukan berasal dari siswa atau kelas yang tidak valid; kegagalan terjadi lebih awal pada query pengunci.

## Perbaikan

- ID ujian sekarang dikirim sebagai satu nilai UUID ke parameter `$1`.
- Penguncian baris dan transaksi atomik tetap dipertahankan.
- Regresi penugasan sekarang memeriksa bentuk argumen query pengunci, sehingga array bersarang tidak dapat kembali tanpa membuat tes gagal.
- Skema database aktif dikonfirmasi memiliki kolom kelas asal peserta, foreign key kelas reguler/tambahan, foreign key profil, unique key `(exam_id, user_id)`, dan batas maksimal satu kelas asal.

## Verifikasi

- Lima regresi penugasan ujian: lulus.
- Lima regresi pemulihan pilihan peserta: lulus.
- TypeScript backend tanpa incremental cache: lulus.
- Query pengunci dengan parameter UUID scalar melalui Prisma dan PostgreSQL aktif: lulus.
- Build shared package dan NestJS backend: lulus.

Perbaikan ini tidak membutuhkan migrasi atau perubahan data. Penugasan lama tidak dihapus karena transaksi sebelumnya gagal sebelum tahap penghapusan sasaran.
