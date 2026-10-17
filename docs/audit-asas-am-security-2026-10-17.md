# Audit ASAS dan Asesmen Madrasah — 17 Oktober 2026

Audit terhadap kode workspace saat ini. Alur administrasi saat audit sudah mencakup draft, submit, ACC, dan pengembalian dokumen. Produksi tidak diuji dengan permintaan yang mengubah data. Reproduksi memakai layanan aplikasi dan database fixture di memori; kode aplikasi serta database produksi tidak diubah oleh audit ini.

## Status perbaikan

Seluruh tujuh temuan dan risiko privasi tambahan diperbaiki pada 17 Oktober 2026. Rincian di bawah merekam kondisi sebelum perbaikan.

- Penambahan jadwal, pembangkitan, dan aktivasi kini memakai otorisasi baca bank asli.
- Verifikasi publik mensyaratkan ACC yang masih berlaku dan integritas snapshot versi 3; tidak memuat identitas siswa, catatan, atau insiden. Kode baru memakai token acak 128 bit.
- Pemberi ACC disimpan terpisah dari Proktor pembuat folder. Pengawas tunggal dapat mengakses slot yang ditugaskan, tetapi tidak dapat melakukan ACC.
- Snapshot membekukan isi lengkap, termasuk tiap kehadiran, keterangan, identitas dokumen, dan penandatangan. Perubahan data operasional berikutnya tidak mengubah dokumen resmi.
- Transaksi mutasi memeriksa kunci periode. Penghapusan ruang/folder dengan riwayat ditolak. Rentang tanggal diperiksa terhadap jadwal yang sudah ada; identitas folder yang sudah menghasilkan ujian tidak dapat diubah.
- Dokumen lama perlu diperiksa dan di-ACC ulang; antarmuka menyediakan ACC ulang dan menolak pencetakan resmi sebelum persetujuan versi baru.

Validasi perbaikan: 170 tes terkait lulus, termasuk 19 skenario keamanan baru pada PAS/ASAS, PAT/ASAT, dan AM; pemeriksaan tipe backend/frontend lulus. Migrasi `20261017_06_pas_administration_security.sql` berhasil diterapkan ke database terkonfigurasi. Pengujian perilaku memakai fixture, bukan permintaan mutasi ke aplikasi produksi.

## Temuan terkonfirmasi

### 1. P1 — Bank soal draft guru lain dapat digunakan lewat folder

Lokasi: `apps/api/src/pas/pas-schedules.service.ts`, `addSchedule` sekitar baris 184–208 dan `generateOne` sekitar baris 410–430.

`addSchedule` dan pembangkitan ujian memeriksa bahwa bank berasal dari sekolah yang sama, tetapi tidak memakai kebijakan `assertBankAccess(..., 'read')`. Pada skenario Proktor yang ditolak membuka draft bank milik guru lain, Proktor tetap berhasil menambahkan jadwal dan mengaktifkan ujian yang menggunakan bank itu. Bank sumber tetap `is_published=false`, sedangkan ujian hasilnya `is_published=true`. Terjadi pada PAS dan AM. Skenario memerlukan akun Proktor serta ID bank yang valid; ini bukan akses anonim atau lintas sekolah.

Perbaikan: terapkan otorisasi baca bank yang sama pada penambahan jadwal, pembangkitan, dan aktivasi, termasuk jadwal yang sudah ada. Jangan hanya mengandalkan daftar bank di browser atau kecocokan organisasi.

### 2. P1 — Verifikasi publik mengesahkan dokumen draft dan rejected

Lokasi: `apps/api/src/pas/pas-administration.service.ts`, `verifyDocumentByCode` sekitar baris 1251–1288 dan 1385–1389.

Fungsi hanya mensyaratkan laporan ditemukan. Tidak ada syarat `status === 'approved'` dan persetujuan Proktor. Reproduksi `save_draft` maupun `rejectAdministrationSlot` menghasilkan respons `verified=true`, `valid=true`, dan `integrity_valid=true`. Akibatnya dokumen yang belum disetujui atau sudah ditolak bisa tampil sebagai dokumen resmi melalui kode verifikasi. Terjadi pada PAS dan AM.

Perbaikan: verifikasi resmi harus mensyaratkan persetujuan yang masih berlaku. Pisahkan status dokumen ditemukan dari status dokumen sah. Jangan menampilkan informasi peserta pada dokumen nonresmi.

### 3. P1 — ACC mengganti Proktor pembuat ujian dan merusak hash

Lokasi: `apps/api/src/pas/pas-administration.service.ts`, `approveAdministrationSlot` sekitar baris 1022–1058.

ACC oleh Proktor lain mengganti `proctor_id`, `proctor_name`, dan `proctor_nip` menjadi pengguna yang mengeklik ACC. Ini bertentangan dengan aturan Proktor berasal dari pembuat folder. Perubahan itu juga tidak memperbarui `signature_hash`. Reproduksi pada PAS/AM: status menjadi approved, identitas Proktor berubah, lalu `integrity_valid=false`.

Perbaikan: simpan pemberi ACC pada `approved_by`/`approved_at`, pertahankan identitas Proktor dari pembuat folder, dan gunakan transaksi serta lock slot yang sama dengan penyimpanan. Hitung ulang hash jika isi yang ditandatangani memang diperbarui.

### 4. P1 — Pengawas dengan peran tunggal tidak dapat mengakses Administrasi

Lokasi: `apps/api/src/pas/pas-administration.service.ts` baris 139 dan 172; `apps/api/src/auth/authorization.service.ts` sekitar baris 57–73.

Layanan Administrasi memanggil `assertOrgStaff`, yang hanya menerima Proktor/Admin/Guru. Pengawas baru diperiksa penugasannya setelah gerbang ini. Akun yang hanya berperan Pengawas mendapat 403 pada daftar penugasan dan slot administrasi meskipun benar-benar ditugaskan ke ruang/sesi tersebut. Tes lama memakai mock `assertOrgStaff` yang selalu mengizinkan, sehingga tidak mendeteksinya.

Perbaikan: gunakan gerbang staf pemantauan yang mencakup Pengawas pada alur administrasi, lalu tetap tegakkan penugasan ruang/sesi untuk nonmanajer. Jangan menambahkan Pengawas ke gerbang pengelolaan umum secara global.

### 5. P2 — Hash belum melindungi seluruh isi dokumen

Lokasi: `apps/api/src/pas/pas-administration.service.ts`, `computeAdministrationSignatureHash` sekitar baris 68–84.

Hash mengikat identitas slot, penandatangan, kode, serta jumlah hadir/sakit/izin/alpha. Hash belum mengikat catatan, ringkasan insiden, daftar peserta, status per peserta, atau keterangan absensi. Reproduksi: mengubah catatan/insiden atau menukar status dua peserta sehingga jumlah total tetap sama masih menghasilkan `integrity_valid=true`. Ini membuktikan kelemahan deteksi perubahan isi; tidak membuktikan bahwa pengguna anonim dapat menulis ke database.

Perbaikan: bentuk snapshot dokumen lengkap saat persetujuan, gunakan serialisasi kanonis dan versi signature baru, serta verifikasi snapshot tersebut. Pertahankan kompatibilitas dokumen lama secara eksplisit.

### 6. P2 — Kunci periode belum melindungi semua mutasi dan penghapusan ruang

Lokasi: `apps/api/src/pas/pas.service.ts`, `updatePeriod` sekitar baris 160–202; `apps/api/src/pas/pas-rooms.service.ts`, `removeRoom` sekitar baris 79–85.

Periode `is_locked=true` masih dapat diganti nama/tanggal melalui `updatePeriod`, dan ruangnya masih dapat dihapus melalui `removeRoom`. Keduanya tetap membutuhkan hak Proktor/Admin, sehingga ini merupakan kelemahan kunci operasional, bukan eskalasi peran. Penghapusan ruang berpotensi menghilangkan relasi peserta/pengawas serta administrasi yang memakai FK cascade.

Perbaikan: periksa status kunci di dalam transaksi dengan lock periode, dan tolak penghapusan ruang yang sudah memiliki riwayat administrasi atau pelaksanaan ujian. Samakan kebijakan mutasi ruang/peserta/pengawas dengan mutasi jadwal.

### 7. P2 — Pembaruan folder menerima rentang tanggal terbalik

Lokasi: `apps/api/src/pas/pas.service.ts`, `updatePeriod` sekitar baris 184–202.

Validasi tanggal pada pembuatan tidak diterapkan saat pembaruan. Permintaan `start_date=2026-11-30`, `end_date=2026-10-01` diterima pada PAS dan AM. Pembaruan juga hanya menulis periode; jadwal/ujian yang sudah dibangkitkan tidak diselaraskan atau ditolak ketika menjadi tidak sesuai periode.

Perbaikan: validasi kombinasi tanggal baru dan lama, termasuk tanggal kalender yang valid; tolak perubahan yang membuat jadwal/ujian aktif keluar periode atau terapkan kebijakan pembaruan terkontrol.

## Risiko privasi tambahan

Endpoint verifikasi publik mengembalikan nama peserta tidak hadir beserta status dan keterangan, catatan, dan ringkasan insiden (`non_present_students`, `notes`, `incident_summary`). Siapa pun yang memperoleh kode/QR dapat membacanya tanpa login. Perlu diputuskan batas informasi publik; sebaiknya verifier publik hanya menampilkan identitas dokumen, status persetujuan, penandatangan, dan rekap agregat. Kode saat ini deterministik dari ID slot/tanggal dan memakai token delapan digit heksadesimal; tidak boleh dianggap sebagai pengganti autentikasi untuk rincian pribadi.

## Validasi

- Pemeriksaan tipe backend lulus.
- 151 tes regresi terkait administrasi, monitoring, kesiapan, ruang/sesi, dan keamanan akses siswa lulus.
- Reproduksi tambahan mengonfirmasi semua temuan di atas pada PAS dan AM. Pengujian tambahan memakai kebijakan otorisasi asli untuk kasus Pengawas tunggal serta bank draft.
- Tidak ditemukan bypass lintas sekolah atau akses soal tanpa penugasan dalam skenario regresi yang dijalankan. Hasil ini tidak menjamin tidak ada celah di luar cakupan audit.
- Status awal audit telah digantikan oleh bagian Status perbaikan di atas.
