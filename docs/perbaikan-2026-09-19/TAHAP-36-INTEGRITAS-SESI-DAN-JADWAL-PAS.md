# Tahap 36 — Integritas sesi dan jadwal PAS

Diperbarui 27 September 2026. Tahap ini memastikan status periode terkunci berlaku pada seluruh mutasi sesi/jadwal dan mencegah jadwal kehilangan sesi waktunya.

## Temuan

Sesi masih dapat ditambah atau dihapus melalui API ketika periode sudah dikunci. Penghapusan jadwal juga belum memeriksa kunci periode, sedangkan generator PAS masih dapat membentuk ujian dari periode terkunci.

Foreign key lama memakai `ON DELETE SET NULL`. Menghapus sesi yang masih digunakan tidak menghapus jadwal, tetapi diam-diam mengosongkan `session_id`. Jadwal kemudian kehilangan identitas sesi walaupun salinan jam masih tersisa.

Operasi tambah sesi, tambah jadwal, dan ubah kunci periode juga belum memakai advisory lock periode yang sama. Request penguncian dan mutasi yang datang bersamaan dapat melihat status berbeda.

## Perbaikan server

- Tambah/hapus sesi, tambah/hapus jadwal, generate, penguncian, dan penghapusan periode memakai lock `pas-period:<id>` yang sama.
- Tambah/hapus sesi dan tambah/hapus jadwal ditolak ketika periode terkunci.
- Generate pada periode terkunci dilewati dengan alasan yang jelas dan tidak membuat ujian.
- Sesi yang masih dipakai jadwal tidak dapat dihapus; pengguna diminta menghapus jadwal terkait terlebih dahulu.
- Nama sesi dirapikan dan nama kosong ditolak.
- UI Admin dan Proktor menyembunyikan tombol tambah/hapus sesi serta menampilkan status periode terkunci.

## Pengaman database

Migrasi `20260927_07_pas_session_integrity.sql`:

- mewajibkan `pas_period_id`, `session_id`, dan `duration_minutes`;
- memastikan jam selesai sesi setelah jam mulai;
- memastikan jendela jadwal berakhir setelah jam mulai dan durasi positif;
- menambahkan foreign key gabungan `(session_id, pas_period_id)` agar sesi dan jadwal berasal dari periode yang sama;
- mengganti perilaku delete sesi menjadi `ON DELETE RESTRICT`;
- menambahkan indeks pencarian sesi–periode.

Audit sebelum migrasi menemukan 0 jadwal PAS, 0 sesi yatim, 0 sesi/jadwal tanpa periode, dan 0 relasi lintas periode. Karena itu migrasi tidak membutuhkan backfill.

Migrasi telah diterapkan permanen ke `acca_db`. Verifikasi melalui koneksi baru memastikan empat kolom menjadi `NOT NULL`, empat constraint aktif/tervalidasi, dan dua indeks tersedia. Audit lifecycle akhir menghasilkan 0 blocker dan 0 warning.

## Verifikasi

Delapan tes `SESSION-01` sampai `SESSION-08` mencakup periode terkunci, sesi terpakai, sesi bebas, tambah/hapus jadwal, generate, lock transaksi, kontrak migrasi, serta UI Admin/Proktor.

Seluruh 14 migrasi lulus dry run dan pengulangan idempoten. Regresi generator dan penghapusan ujian juga lulus.

## Berkas utama

- `apps/api/src/pas/pas-schedules.service.ts`
- `apps/api/src/pas/pas.service.ts`
- `apps/web/app/dashboard/admin/pas/RoomManagementModal.tsx`
- `apps/web/app/dashboard/proktor/pas/RoomManagementModal.tsx`
- `database/migrations/20260927_07_pas_session_integrity.sql`
- `apps/api/test/pas-session-integrity-stage36.test.cjs`

