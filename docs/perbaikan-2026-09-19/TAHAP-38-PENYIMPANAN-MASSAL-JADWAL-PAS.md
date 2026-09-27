# Tahap 38 — Penyimpanan massal jadwal PAS

Diperbarui 28 September 2026. Tahap ini memperbaiki pelaporan hasil, retry, dan pencegahan duplikasi pada input massal jadwal PAS.

## Temuan

Komponen lama mengirim seluruh baris dengan `Promise.all`, tetapi helper HTTP mengembalikan `{ success: false }` untuk kegagalan server dan tidak melempar exception. Akibatnya, kumpulan promise dianggap berhasil, form ditutup, dan operator dapat mengira semua jadwal tersimpan meskipun satu atau beberapa baris ditolak.

Jika jaringan atau validasi hanya menggagalkan sebagian permintaan, baris yang berhasil sudah masuk database. Form tidak mencatat baris tersebut. Percobaan ulang seluruh data kemudian dapat bertabrakan dengan indeks unik. Baris yang terisi sebagian juga dilewati tanpa pemberitahuan.

## Perbaikan

Input massal sekarang memeriksa hasil setiap baris dan menampilkan status `Menyimpan`, `Tersimpan`, atau pesan kegagalan pada baris terkait. Baris yang berhasil dikunci pada layar dan tidak dikirim ulang. Tombol coba lagi hanya memproses baris yang gagal atau sudah diperbaiki.

Baris kosong tetap boleh digunakan sebagai baris tambahan dan diabaikan. Baris yang terisi sebagian ditandai untuk dilengkapi. Duplikat kombinasi bank soal dan kelas dalam satu batch ditolak sebelum request, sesuai pengaman unik database.

Gangguan jaringan pada satu baris tidak menghapus hasil baris lain. Helper `apiCreate` mempertahankan kunci permintaan ketika hasil server masih ambigu, sehingga retry setelah timeout tetap memakai mekanisme idempotensi yang sudah dipasang pada database.

Komponen Admin dan Proktor sekarang memakai satu implementasi bersama. Jika operator menutup form setelah sebagian data berhasil, daftar jadwal dimuat ulang agar hasil yang sudah masuk langsung terlihat.

## Verifikasi

Tujuh tes `BULK-01` sampai `BULK-07` mencakup respons gagal tanpa exception, retry hanya untuk baris gagal, baris kosong dan sebagian, duplikat dalam batch, gangguan jaringan parsial, paritas Admin/Proktor, serta pengaman idempotensi dan indeks unik.

Seluruh 252 tes Node pada 37 berkas lulus. Pemeriksaan TypeScript frontend dan build produksi 92 halaman juga lulus. Tahap ini tidak membutuhkan migrasi baru karena indeks idempotensi dan indeks unik jadwal sudah diterapkan permanen pada Tahap 27.

## Berkas utama

- `apps/web/app/components/pas/BulkScheduleGrid.tsx`
- `apps/web/lib/pas/bulk-schedule.ts`
- `apps/web/app/dashboard/admin/exams/pas/[id]/BulkScheduleGrid.tsx`
- `apps/web/app/dashboard/proktor/exams/pas/[id]/BulkScheduleGrid.tsx`
- `apps/api/test/pas-bulk-schedule-stage38.test.cjs`
