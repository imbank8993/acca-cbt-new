# QA-03 — Implementasi bersama halaman detail bank soal

Diperbarui 26 September 2026. Dokumen ini mencatat perbaikan QA-03: duplikasi halaman berdasarkan peran yang membuat perubahan UI mudah tidak merata.

## Masalah yang ditemukan

Route detail bank soal admin, guru, dan proktor masing-masing memuat sekitar 1.088 baris kode yang hampir identik. Setiap koreksi pada editor, impor, stimulus, urutan soal, ekspor, atau pratinjau harus disalin ke tiga tempat.

Perbandingan sumber menunjukkan hanya dua kelompok perbedaan yang sah: jalur kembali/cetak sesuai peran dan namespace state sementara. Dalam salinan admin, namespace tersebut justru memakai awalan `proktor`. Ketiga halaman juga mempunyai `handleExportTemplate` yang tidak pernah dipanggil dan membuka `/template_soal.docx`, padahal tautan itu tidak menjadi bagian alur impor aktif.

Risiko utamanya:

- perbaikan hanya masuk ke satu atau dua peran;
- state sementara admin dan proktor memakai namespace yang sama untuk bank dengan ID yang sama;
- tautan mati dapat digunakan kembali tanpa sengaja;
- hasil lint membesar karena pelanggaran yang sama dihitung tiga kali.

## Perubahan

Implementasi detail bank dipindahkan ke `QuestionBankDetailPage`. Komponen menerima nilai `admin`, `guru`, atau `proktor` untuk dua kebutuhan presentasi saja:

- membentuk `/dashboard/{role}/questions` untuk navigasi kembali dan pratinjau cetak;
- membentuk `{role}_questions_{bankId}` untuk memisahkan state sementara setiap area dashboard.

Ketiga file route kini hanya merender komponen bersama dengan nilai route masing-masing. Fungsi dan tautan template DOCX mati dihapus.

## Batas keamanan

Nilai `role` pada komponen bukan sumber otorisasi. Pengguna dapat memodifikasi data browser, sehingga pembatasan akses tetap dilakukan pada backend:

- controller bank soal memakai `JwtAuthGuard` dan `RolesGuard`;
- operasi terhadap bank memanggil `AuthorizationService.assertBankAccess`;
- operasi dengan ID soal memanggil `assertBankAccessByChild` sebelum mutasi.

Komponen bersama tetap memakai fungsi API yang sama. Refactor ini tidak menambah prop seperti `canEdit`, tidak mengirim izin dari browser, dan tidak mengubah kontrak endpoint.

## Pengujian regresi

`role-page-parity-stage12.test.cjs` memeriksa empat kontrak:

1. seluruh route admin, guru, dan proktor memakai komponen yang sama serta tetap berupa pembungkus tipis;
2. namespace cache dan URL navigasi dibentuk dari route peran tanpa jalur peran yang ditulis permanen di komponen;
3. `handleExportTemplate` dan `/template_soal.docx` tidak muncul lagi;
4. guard controller serta pemeriksaan akses bank pada service backend tetap ada.

Paket lengkap menjalankan 106 tes Node, 44 pemeriksaan round-trip impor/ekspor, dan 13 pemeriksaan service. TypeScript API dan frontend lulus. Baseline ESLint turun dari 1.338 error/709 warning menjadi 1.214 error/640 warning dan angka yang lebih rendah sudah disimpan sebagai batas baru.

## Dampak dan batas validasi

Jumlah sumber UI untuk fitur ini turun dari sekitar 3.264 baris salinan menjadi satu komponen 1.087 baris dan tiga route 5 baris. Koreksi berikutnya pada detail bank soal otomatis berlaku untuk ketiga peran.

Pengujian ini berbasis sumber dan unit/integrasi lokal. Sebelum rollout, lakukan smoke test di browser dengan akun admin, guru, dan proktor: buka bank yang sama, ubah soal sesuai hak akses backend, jalankan impor, buka pratinjau cetak, lalu kembali ke daftar bank. Audit masih mencatat duplikasi di halaman besar lain sebagai utang pemeliharaan umum, tetapi QA-03 ditutup pada alur bank soal yang menjadi lokasi bukti dan paling sering berubah selama perbaikan BUG-11/IMP-01.
