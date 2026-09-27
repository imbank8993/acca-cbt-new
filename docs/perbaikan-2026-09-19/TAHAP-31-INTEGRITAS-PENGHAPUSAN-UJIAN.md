# Tahap 31 — Integritas penghapusan ujian dan data uji coba

Diperbarui 27 September 2026. Tahap ini mencegah penghapusan jadwal, periode, bank konfigurasi, konfigurasi, atau ujian meninggalkan data setengah terhapus dan melindungi rekam pengerjaan siswa dari tombol hapus biasa.

## Temuan

Penghapusan jadwal PAS mencoba menghapus ujian sebelum jadwal. Foreign key produksi tidak memakai `ON DELETE CASCADE` atau `SET NULL`, sehingga penghapusan ujian dapat gagal. Galat itu diabaikan, jadwal tetap dihapus, dan ujian tertinggal sebagai data yatim.

Penghapusan jadwal konfigurasi, bank konfigurasi, dan konfigurasi juga menjalankan penghapusan ujian serta sumbernya sebagai operasi terpisah. Sebagian galat database tidak diperiksa. Kegagalan tengah proses dapat meninggalkan sumber tanpa ujian atau ujian tanpa sumber.

Penghapusan periode PAS sebelumnya hanya menghapus periode beserta jadwal melalui cascade. Ujian hasil generate tidak ikut terhapus dan dapat tetap terlihat sebagai ujian yatim.

Masalah paling berisiko berada pada tombol hapus ujian umum. Jalur lama secara eksplisit menghapus attempt, jawaban, log keamanan, snapshot, dan data soal attempt sebelum menghapus ujian. Kesalahan klik dapat menghilangkan seluruh rekam ujian siswa secara permanen.

UI bahkan menampilkan pesan bahwa seluruh data pengerjaan akan ikut terhapus, tetapi tidak menampilkan kegagalan backend pada beberapa tombol.

## Penghapusan biasa yang aman

Penghapusan biasa sekarang hanya diizinkan bila ujian belum mempunyai attempt atau sertifikat. Jika riwayat sudah ada, server menolak penghapusan dan menyarankan membatalkan publikasi atau mengarsipkan ujian.

Pemeriksaan dan penghapusan berjalan dalam transaksi. Baris ujian dikunci dengan `FOR UPDATE`, sehingga attempt atau sertifikat baru tidak dapat masuk setelah pemeriksaan riwayat tetapi sebelum delete.

Jadwal PAS, periode PAS, jadwal konfigurasi, bank konfigurasi, dan konfigurasi memakai advisory lock induk serta lock sumber yang sama dengan generator. Generate dan delete untuk sumber yang sama tidak dapat berjalan saling menyalip.

Urutan PAS diperbaiki: jadwal atau periode dilepas lebih dulu di dalam transaksi, kemudian ujian yang belum mempunyai riwayat dihapus. Bila penghapusan ujian gagal, rollback mengembalikan jadwal/periode.

Penghapusan konfigurasi menghapus ujian belum terpakai dan sumbernya dalam transaksi yang sama. Konfigurasi terkunci tetap tidak dapat diubah atau dihapus.

## Penghapusan khusus ujian uji coba

Ujian uji coba yang belum pernah dikerjakan dapat dihapus melalui tombol biasa. Untuk uji coba yang sudah mempunyai attempt, tersedia jalur khusus **hapus data uji coba** dengan syarat:

1. hanya Admin atau Proktor;
2. ujian sudah tidak dipublikasikan;
3. pengguna mengetik ulang judul ujian persis;
4. seluruh penghapusan berjalan dalam satu transaksi.

Jalur khusus membersihkan attempt, jawaban, log keamanan, snapshot pengawasan, soal attempt, sertifikat, target, peserta, jadwal, sumber soal, dan ujian. Jumlah attempt yang dihapus dikembalikan dan ditampilkan UI. Aktivitas purge dicatat pada log server.

Guru tidak mendapat endpoint purge permanen. Tombol biasa Guru tetap dapat menghapus draft yang belum pernah dikerjakan.

Jika tahap akhir penghapusan gagal, rollback mengembalikan seluruh hasil uji coba dan tautan jadwal.

## Audit database nyata

Audit baca-saja setelah perbaikan menemukan:

- ujian PAS yatim: 0;
- ujian konfigurasi yatim: 0;
- sumber PAS dengan lebih dari satu ujian: 0;
- sumber konfigurasi dengan lebih dari satu ujian: 0;
- ujian hasil generate yang sudah mempunyai attempt: 0.

Tidak diperlukan pembersihan data atau migrasi baru pada tahap ini.

## Verifikasi

Tiga belas tes `DEL-01` sampai `DEL-13` membuktikan:

- hapus biasa ditolak ketika attempt tersedia;
- kegagalan delete mengembalikan tautan PAS;
- jadwal/periode PAS rollback secara utuh;
- jadwal dan konfigurasi rollback secara utuh;
- lock induk dan sumber dipakai bersama generator;
- baris ujian dikunci sebelum pemeriksaan riwayat;
- UI tidak lagi menjanjikan penghapusan hasil siswa;
- kegagalan ditampilkan pada UI Admin, Guru, dan Proktor;
- purge wajib tidak dipublikasikan dan judul harus sama;
- purge berhasil membersihkan seluruh data uji coba;
- kegagalan akhir purge mengembalikan seluruh hasil;
- endpoint purge hanya tersedia untuk Admin/Proktor.

Hasil akhir:

- 13 tes Tahap 31: lulus;
- 208 tes regresi Node dalam 30 berkas: lulus;
- typecheck frontend: lulus;
- build shared dan backend: lulus;
- tidak ada migrasi baru.

## Cara menghapus ujian uji coba

1. Buka daftar ujian sebagai Admin atau Proktor.
2. Jika masih dipublikasikan, batalkan publikasinya.
3. Tekan hapus.
4. Hapus biasa akan ditawarkan lebih dulu.
5. Jika ujian mempunyai hasil, UI meminta judul ujian diketik ulang.
6. Setelah judul cocok, seluruh data uji coba dihapus secara permanen dan jumlah pengerjaan yang dibersihkan ditampilkan.

## Batas lanjutan

Aplikasi belum mempunyai status arsip terpisah. Untuk ujian nyata yang sudah selesai, pilihan aman saat ini adalah mempertahankan data dan membatalkan publikasi. Tahap berikutnya dapat menambahkan arsip agar daftar aktif tetap ringkas tanpa menghapus rekam akademik.

Perubahan bank, kelas, waktu, atau durasi konfigurasi setelah ujian dibangkitkan juga masih perlu diaudit agar sumber dan ujian hasil generate tidak menyimpang.

## Berkas utama

- `apps/api/src/common/exam-deletion.ts`
- `apps/api/src/exams/exams.service.ts`
- `apps/api/src/exams/exams.controller.ts`
- `apps/api/src/pas/pas-schedules.service.ts`
- `apps/api/src/pas/pas.service.ts`
- `apps/api/src/exam-configs/exam-configs.service.ts`
- `apps/web/lib/api/exams.ts`
- `apps/web/app/dashboard/admin/exams/page.tsx`
- `apps/web/app/dashboard/proktor/exams/page.tsx`
- `apps/api/test/exam-deletion-stage31.test.cjs`
