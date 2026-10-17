# Audit screenshot pelanggaran dan Asesmen Madrasah

## Temuan dan perbaikan screenshot

- `ExamPage` sebelumnya dapat menjalankan reload dari `flushSecurityEvents` saat pelanggaran terakhir menyebabkan auto-submit, sebelum pemanggil mengunggah screenshot. Jalur kejadian sekarang menunda reload dan menunggu upaya unggah selesai.
- Unggah yang gagal sebelumnya tidak diulang. Pengiriman sekarang mengulang kegagalan jaringan/server sementara maksimal tiga percobaan, menggunakan event ID dan gambar yang sama. Penolakan permanen tidak diulang; idempotensi server mencegah duplikasi jika respons sebelumnya hilang.
- `AttemptScreenshots` sebelumnya membaca daftar hanya ketika panel dibuka. Panel kini memperbarui daftar setiap 10 detik dan membersihkan timer ketika ditutup.

## Pengamanan yang ditinjau

Server memeriksa pemilik attempt, fingerprint perangkat, pengaturan screenshot ujian, dan kejadian siswa yang sah. Gambar dibatasi 200 KB, JPEG/WebP, maksimal 10 per attempt, dengan jeda 30 detik. Unggah pertama harus terkait kejadian server berumur maksimal 120 detik. Bukti dienkripsi AES-256-GCM; akses baca memerlukan izin monitoring dan cakupan peserta yang sesuai. Gambar kedaluwarsa setelah tujuh hari. Jalur gambar memakai `private, no-store`.

Tes memverifikasi penolakan akses lintas ruang, replay idempoten, perubahan payload, kegagalan penyimpanan, kedaluwarsa, dan penerimaan screenshot terakhir sesudah auto-submit.

## Batas pemeriksaan

Ini merupakan audit kode dan pengujian otomatis, belum uji browser dengan izin berbagi layar nyata. Pengambilan membutuhkan browser desktop yang mendukung `getDisplayMedia`, izin Seluruh Layar, penyimpanan objek, kunci enkripsi stabil, dan migrasi screenshot yang sudah terpasang. Tidak setiap catatan menghasilkan gambar: cooldown, kuota, kegagalan capture, atau koneksi terputus dapat menghalanginya. Gambar tidak disimpan sebagai antrean offline persisten; tiga percobaan tidak menjamin pemulihan sesudah reload atau putus jaringan berkepanjangan. `focus_interruption` memang tidak mengambil screenshot pada alur saat ini.

## Asesmen Madrasah

Jenis `am` memakai folder periode dan pembangkitan jadwal yang sama dengan ASAS/ASAT, termasuk bank soal, kelas, ruang, sesi, dan pewarisan pengaturan screenshot. Jenis ini tersedia pada modal pembuatan ujian serta pembuatan periode Admin/Proktor, memiliki label/filter tersendiri, dan mengikuti penugasan pengawas per ruang/sesi. Guru tidak mendapat akses pengelolaan khusus ujian AM. Pemetaan filter `asas_asat` juga diperbaiki agar tidak jatuh ke kategori Lainnya.

Migrasi `database/migrations/20261017_02_asesmen_madrasah.sql` sudah diterapkan ke database `acca_db` pada 17 Oktober 2026 menggunakan `tools/apply-migrations.js --files=20261017_02_asesmen_madrasah.sql --confirm`. Transaksi berhasil COMMIT. Pemeriksaan ulang constraint `cbt_pas_periods.type` dan `cbt_exams.exam_type` mengonfirmasi bahwa keduanya menerima `am`. Tabel berita acara, daftar hadir, dan screenshot juga sudah tersedia.

AM dan ASAS/ASAT kini memakai klasifikasi folder serta implementasi daftar/detail folder yang sama. Kebijakan backend PAS, PAT, dan AM disatukan untuk pengelolaan, monitoring, reset, dan susulan; ini sekaligus menutup perbedaan lama ketika PAT belum mendapatkan hak pemulihan yang sama dengan PAS. Pengawas tetap dibatasi peserta di ruang/sesi penugasannya. Label proktor pada pratinjau/cetak dan nama file PDF administrasi mengikuti jenis ujian. Kode verifikasi dokumen lama tetap dipertahankan.

## Validasi

189 tes terarah lulus. Pengujian diperluas dengan kasus yang sama untuk PAS, PAT, dan AM: monitoring/izin pengawas, reset dan susulan, pewarisan pengaturan screenshot, aktivasi/nonaktif/aktivasi ulang tanpa kehilangan jawaban, serta penyimpanan daftar hadir dan verifikasi tanda tangan berita acara. Pemeriksaan tipe frontend dan backend lulus. Lint modal/halaman folder dan helper lolos tanpa error (sembilan peringatan variabel/import tidak terpakai pada halaman ujian). Lint pada panel administrasi masih melaporkan lima error lama pada aturan React Hooks; perubahan label tidak mengubah alur sinkronisasi tersebut.

## Pembaruan tiga penandatangan

Berita acara dan daftar hadir kini memuat Pengawas Ruang, Proktor pembuat folder ujian, dan Mengetahui Ketua Panitia. Identitas Proktor ditetapkan server dari pembuat folder; nilai pengganti dari klien diabaikan. Ketua Panitia diisi melalui menu Pengaturan pada Admin/Proktor (`/dashboard/admin/settings` atau `/dashboard/proktor/settings`), key `exam_administration`; nama wajib dan NIP opsional. Nama belum diisi pada database saat pemeriksaan ini, sehingga penandatanganan baru meminta pengguna melengkapinya.

Migrasi `20261017_03_administration_committee_chair.sql` berhasil COMMIT pada `acca_db`. Dokumen baru memakai signature versi 2 yang melindungi nama/NIP Ketua Panitia dan NIP Proktor. Identitas disimpan saat dokumen ditandatangani. Perubahan pengaturan atau profil berikutnya tidak mengubah salinan dokumen yang sudah disahkan; cetak ulang tanpa perubahan juga tidak menandatangani ulang. Dokumen versi 1 tetap dapat diverifikasi dan dapat disimpan ulang untuk menambahkan Ketua Panitia.

86 tes terarah lulus pada pembaruan ini, termasuk pengaturan, penolakan penggantian Proktor, snapshot, kompatibilitas tanda tangan lama, serta penggabungan tiga penandatangan pada PDF. Pemeriksaan tipe frontend/backend dan lint komponen pengaturan/helper baru lulus. Contoh PDF ASAS dan AM dirender dan diperiksa visual menggunakan helper footer produksi; nama panjang membungkus dan tidak bertabrakan dengan QR.
