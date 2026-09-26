# Tahap 21 — Backup dan restore untuk instalasi satu sekolah

Diperbarui 26 September 2026. Tahap ini memeriksa jalur backup setelah aplikasi dikunci ke satu sekolah. Backup adalah operasi berisiko tinggi karena restore menghapus data aktif sebelum memasukkan isi arsip.

## Temuan

### SCHOOL-07 — ID sekolah masih berasal dari browser

Halaman backup mengambil sekolah melalui endpoint organisasi, lalu mengirim ID tersebut kembali lewat URL, multipart form, DTO NestJS, dan service. Walaupun otorisasi memeriksa ID, alur itu masih mempertahankan konsep bahwa browser memilih sekolah tujuan.

Perbaikan:

- endpoint export, import, dan pemeriksaan izin tidak lagi menerima `organizationId`;
- `BackupService` mengambil sekolah langsung dari `SingleSchoolService`;
- halaman Admin dan Proktor tidak lagi memuat atau mengirim ID sekolah;
- pemeriksaan izin tetap dilakukan sebelum multipart dibaca dan sebelum ZIP dibuka;
- metadata sekolah pada arsip tetap disimpan untuk informasi, tetapi tidak pernah menjadi sekolah tujuan restore.

### SCHOOL-07 — ID sekolah lama dapat ikut pada baris anak

Baris utama seperti bank soal dan ujian memang sudah ditimpa dengan ID tujuan, tetapi kelompok `plain` dan `withUser` mempertahankan setiap properti `organization_id` yang mungkin terdapat dalam arsip. Arsip dari lingkungan lain dapat membawa UUID sekolah lama pada baris anak.

Perbaikan: setiap baris yang mempunyai properti `organization_id` dipetakan ke sekolah lokal sebelum insert. Tabel utama tetap selalu dipaksa memakai sekolah lokal meskipun properti tersebut hilang dari arsip.

### SCHOOL-08 — Identitas pengguna duplikat tidak dideteksi

Pemeriksaan duplikat generik hanya melihat properti `id`, sedangkan `users_data` memakai `original_user_id`. Dua entri dengan ID asal sama dapat saling menimpa pada peta pengguna. Email yang sama dengan kapitalisasi berbeda juga dapat mengarah pada satu akun dan menyebabkan kegagalan keanggotaan di tengah restore.

Perbaikan: validasi sekarang menolak `original_user_id` duplikat dan email duplikat secara case-insensitive sebelum akun dibuat, data lama dihapus, atau transaksi restore dimulai.

## Verifikasi

Dua tes tambahan membuktikan bahwa:

1. ID sekolah asing pada tabel utama dan tabel anak selalu menjadi ID sekolah lokal;
2. `original_user_id` duplikat ditolak sebelum ada penulisan atau penghapusan.

Seluruh enam tes integritas backup dan tiga tes keamanan arsip lulus. Build backend/shared dan typecheck frontend juga lulus.

## Batas verifikasi

Tes memakai database fixture dan tidak menjalankan restore pada PostgreSQL staging atau bucket R2 nyata. Uji staging tetap diperlukan untuk membuktikan urutan foreign key, rollback PostgreSQL, pemetaan gambar, dan pembersihan objek ketika restore gagal. Database sekolah tidak disentuh pada tahap ini.
