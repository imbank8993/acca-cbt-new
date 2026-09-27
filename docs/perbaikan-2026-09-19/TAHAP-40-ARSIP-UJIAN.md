# Tahap 40 — Arsip ujian

Diperbarui 28 September 2026. Tahap ini menyediakan cara menyembunyikan ujian lama tanpa menghapus jawaban, nilai, log pengawasan, atau sertifikat.

## Perbaikan

Admin, Proktor, dan Guru memiliki tab Arsip dan tombol arsip pada kartu ujian. Ujian yang diarsipkan tidak muncul pada tab Semua, otomatis tidak dipublikasikan, dan tetap dapat dibuka melalui tab Arsip.

Server menolak pengarsipan jika masih ada attempt `in_progress`. Proses arsip hanya mengubah status ujian serta metadata audit; seluruh data hasil tetap utuh. Operasi yang sama aman diulang.

Pemulihan arsip selalu menghasilkan draft yang belum dipublikasikan. Operator harus memeriksa jadwal dan penugasan sebelum menerbitkannya lagi. Ujian berstatus arsip tidak dapat diedit, diterbitkan, atau diubah penugasannya sebelum dipulihkan.

Status `archived` sudah termasuk pada skema ujian. Database aktif juga menerima perubahan status tersebut dalam transaksi verifikasi yang kemudian di-rollback, sehingga tidak diperlukan migrasi baru.

## Verifikasi

Enam tes `ARCHIVE-01` sampai `ARCHIVE-06` mencakup pemeliharaan hasil, penolakan attempt aktif, pemulihan aman ke draft, idempotensi, paritas tiga peran, kontrak API, dan proteksi mutasi.

Regresi lengkap menghasilkan 263 tes Node pada 39 berkas tanpa kegagalan. Audit database aktif menghasilkan nol blocker dan nol warning. Build backend, TypeScript API/frontend, dan build produksi 92 halaman lulus.

## Berkas utama

- `apps/api/src/exams/exams.service.ts`
- `apps/api/src/exams/exams.controller.ts`
- `apps/api/src/exams/dto/archive-exam.dto.ts`
- `apps/api/src/proctor/exam-admin.service.ts`
- `apps/web/lib/api/exams.ts`
- `apps/web/app/api/exams/[id]/archive/route.ts`
- `apps/api/test/exam-archive-stage40.test.cjs`
