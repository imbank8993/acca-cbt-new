# Tahap 35 — Sinkronisasi ujian hasil generate

Diperbarui 27 September 2026. Tahap ini mencegah konfigurasi sumber dan ujian yang dilihat siswa mempunyai durasi, mata pelajaran, atau identitas yang berbeda setelah proses generate.

## Temuan

Endpoint perubahan bank konfigurasi sebelumnya hanya memperbarui `exam_config_banks`. Jika jadwal sudah pernah di-generate, baris `cbt_exams` yang dipakai siswa tetap menyimpan nilai lama.

Contohnya, proktor dapat mengubah durasi dari 90 menjadi 120 menit pada konfigurasi, sementara siswa tetap menerima ujian berdurasi 90 menit. Masalah yang sama berlaku pada mata pelajaran. Perubahan nama atau tahun ajaran konfigurasi juga tidak menyelaraskan deskripsi ujian hasil generate.

Jalur perubahan tersebut tidak memeriksa `is_locked`, tidak memakai transaksi, dan dapat beradu dengan proses generate atau penguncian konfigurasi. Validasi jadwal juga belum menolak tanggal di luar rentang konfigurasi atau jam tutup yang mendahului jam mulai.

## Perbaikan

Perubahan konfigurasi sekarang menggunakan satu transaksi dan advisory lock yang sama dengan generator. Server melakukan langkah berikut secara atomik:

1. mengunci konfigurasi dan seluruh jadwal yang terkait;
2. membaca ulang sumber setelah lock diperoleh;
3. menolak perubahan isi jika konfigurasi terkunci;
4. mengunci baris `cbt_exams` hasil generate;
5. memastikan ujian belum mempunyai attempt atau sertifikat;
6. memperbarui ujian hasil generate dan sumber konfigurasi dalam transaksi yang sama.

Durasi dan mata pelajaran disalin ke semua ujian terkait. Nama serta tahun ajaran menyusun ulang deskripsi berdasarkan kelas setiap jadwal. Jika salah satu pembaruan gagal, seluruh perubahan dibatalkan sehingga kedua sisi tetap sama.

Perubahan identik diperlakukan sebagai no-op. Karena itu retry atau penyimpanan ulang nilai yang sama tetap aman walaupun ujian sudah mempunyai riwayat. Perubahan nyata ditolak setelah attempt atau sertifikat terbentuk agar rekam akademik tidak berubah.

## Validasi tambahan

- Mata pelajaran saat menambah atau mengubah bank wajib berasal dari sekolah yang sama.
- Rentang tanggal baru tidak boleh meninggalkan jadwal lama di luar rentang.
- Jadwal baru wajib berada dalam rentang tanggal konfigurasi jika batasnya diisi.
- Jam tutup jadwal wajib setelah jam mulai.
- Penambahan bank, penambahan jadwal, perubahan, generate, delete, dan penguncian memakai lock konfigurasi yang sama sehingga status terkunci tidak dapat dilewati oleh request bersamaan.

Tidak ditambahkan endpoint edit jadwal baru. Layar saat ini membuat atau menghapus jadwal, sehingga perubahan kelas dan waktu setelah generate tetap melalui penghapusan aman yang sudah dilindungi pada Tahap 31.

## Audit database aktif

`tools/audit-generated-exam-sync.js` dijalankan secara read-only terhadap `acca_db`. Audit membandingkan sumber dengan ujian hasil generate untuk bank soal, mata pelajaran, durasi, waktu, target kelas, metadata tautan, dan perbedaan pada ujian yang sudah mempunyai riwayat.

Seluruh pemeriksaan menghasilkan **0 temuan**. Tidak ada data lama yang diubah dan tahap ini tidak memerlukan migrasi database.

## Verifikasi

Sembilan tes `SYNC-01` sampai `SYNC-09` membuktikan sinkronisasi, penolakan perubahan ber-riwayat, rollback, penguncian, isolasi sekolah, no-op yang aman, serta validasi tanggal dan jam.

## Berkas utama

- `apps/api/src/exam-configs/exam-configs.service.ts`
- `apps/api/test/generated-exam-sync-stage35.test.cjs`
- `tools/audit-generated-exam-sync.js`

