# Tahap 75 — Ujian Susulan Penuh dan Ekspor Jawaban

Tanggal penyelesaian: 30 September 2026

## Tujuan

Tahap ini menambahkan ujian susulan untuk satu siswa pada ujian yang sudah selesai dan memperjelas perbedaannya dari pemulihan biasa. Tahap ini juga memperbarui ekspor Excel agar identitas siswa, soal, opsi, kunci, jawaban, status, dan skor dapat diperiksa dalam satu lembar yang mudah dibaca.

## Perbedaan tindakan

| Tindakan | Jawaban lama | Nilai lama | Waktu | Hasil akhir |
|---|---|---|---|---|
| Pulihkan | Dipertahankan | Dikosongkan lalu dihitung lagi saat submit | Tenggat lama dipakai bila masih berlaku; jika habis diberikan 15 menit pemulihan | Tetap pada rekap ujian yang sama |
| Ujian Susulan Penuh | Dihapus seluruhnya | Dihapus | Waktu baru khusus siswa, 1–1440 menit sejak susulan diaktifkan | Tetap pada rekap ujian yang sama |

Ujian susulan memakai `attempt_id` dan `exam_id` yang sama. Sistem tidak membuat ujian duplikat atau rekap terpisah. Setelah siswa menyelesaikan susulan, jawaban dan nilai barunya menggantikan hasil lama pada daftar peserta ujian semula.

## Alur ujian susulan penuh

Tindakan tersedia untuk attempt berstatus `submitted` atau `auto_submitted`. Staf memilih **Susulan / Pulihkan**, mengetik `SUSULAN`, mengisi alasan, menentukan durasi, lalu menyetujui peringatan penghapusan.

Server menjalankan langkah berikut dalam satu transaksi database:

1. memeriksa bahwa pengguna merupakan staf yang berwenang untuk ujian;
2. mengunci attempt agar dua tindakan tidak berjalan bersamaan;
3. memeriksa kunci permintaan untuk percobaan ulang akibat respons jaringan yang hilang;
4. menghitung dan menghapus seluruh baris `cbt_answers` milik attempt;
5. mengubah status menjadi `in_progress`;
6. menetapkan `started_at` baru dan `personal_end_time` sesuai durasi susulan;
7. menghapus nilai klasik, nilai IRT, theta, status penilaian manual, serta metadata nilai lama;
8. mengosongkan hitungan pelanggaran dan ikatan perangkat lama;
9. menulis audit `MAKEUP_EXAM_STARTED` beserta alasan, pelaksana, waktu, durasi, status sebelumnya, dan jumlah jawaban yang dihapus.

Jika respons pertama hilang setelah transaksi berhasil, browser mengirim ulang `clientRequestId` yang sama. Server mengembalikan hasil transaksi pertama tanpa menghapus jawaban baru yang mungkin sudah dibuat siswa.

## Pemulihan biasa

Endpoint pemulihan tetap mempertahankan jawaban lama. Server hanya membuka kembali attempt, mengosongkan nilai hasil penutupan sebelumnya, dan memberi tenggat pemulihan bila tenggat lama sudah habis. Audit `RESET_BY_PROCTOR` menyimpan jumlah jawaban yang dipertahankan.

## Ekspor Excel

Ekspor baru menghasilkan berkas `Hasil_dan_Jawaban_<nama ujian>.xlsx`. Lembar `Jawaban_Siswa` ditempatkan paling depan dengan susunan:

- kolom `Nama`;
- kolom `Kelas`;
- satu kolom untuk setiap soal dalam urutan nomor soal;
- header soal memuat nomor, jenis soal, teks, serta opsi jawaban bila tersedia;
- baris di bawah header memuat kunci jawaban;
- setiap baris siswa memuat jawaban yang dipilih/ditulis, status benar-salah-belum dinilai, dan skor per soal.

Jenis soal non-pilihan-ganda menggunakan `display_answer` dan `key_display` dari layanan analitik Python. Karena itu matching, kategorisasi, checklist, ranking, forced choice, paired comparison, isian, dan esai tetap ditampilkan dalam bentuk manusiawi tanpa menebak struktur JSON di browser.

Lembar pendukung tetap tersedia:

1. `Rekap_Hasil` untuk status, nilai, waktu, dan pelanggaran;
2. `Analisis_Butir_Soal` untuk kesukaran, daya beda, dan daftar siswa;
3. `Distribusi_Pengecoh` untuk pilihan ganda;
4. `Detail_Transkrip_Respon` untuk satu baris per siswa dan soal.

Format visual sekarang benar-benar ditulis ke berkas melalui `xlsx-js-style`: judul gabungan, warna header, baris kunci, border, pembungkusan teks, lebar kolom, tinggi baris, filter, dan baris selang-seling.

## Keamanan dan integritas

- Siswa tidak dapat mengaktifkan susulan untuk dirinya sendiri karena otorisasi staf diperiksa di server.
- Penghapusan jawaban dan pembukaan attempt berada pada transaksi yang sama; kegagalan salah satu langkah mengembalikan seluruh perubahan.
- Kunci idempoten mencegah penghapusan ulang bila jaringan putus setelah server berhasil.
- Attempt yang sedang berjalan ditolak agar susulan tidak menghapus jawaban aktif.
- Event susulan adalah tindakan administratif dan tidak dihitung sebagai pelanggaran siswa.
- Batas audit pelanggaran baru dimulai setelah event susulan atau pemulihan terakhir.

## Berkas utama

- `apps/api/src/proctoring/proctoring.controller.ts`
- `apps/api/src/proctoring/proctoring.service.ts`
- `apps/api/src/proctor/exam-monitoring.service.ts`
- `apps/api/test/makeup-exam-stage75.test.cjs`
- `apps/web/lib/api/proctoring.ts`
- `apps/web/lib/export-excel-analysis.ts`
- `apps/web/app/api/proctoring/attempts/[attemptId]/makeup/route.ts`
- `apps/web/app/api/proctoring/attempts/[attemptId]/heartbeat/route.ts`
- `apps/web/app/dashboard/admin/monitoring/page.tsx`
- `apps/web/app/dashboard/guru/monitoring/page.tsx`
- `apps/web/app/dashboard/proktor/monitoring/page.tsx`
- `apps/web/app/dashboard/pengawas/monitoring/page.tsx`

## Migrasi database

Tahap ini tidak memerlukan migrasi SQL. Ujian susulan memakai tabel attempt, jawaban, dan log keamanan yang sudah aktif. Penanda susulan serta tenggat khusus disimpan pada kolom dan metadata yang sudah tersedia.

## Verifikasi otomatis

- Susulan penuh menghapus semua jawaban lama, nilai, statistik keamanan, dan ikatan perangkat.
- Durasi 90 menit menghasilkan tenggat tepat 90 menit dari waktu database.
- Attempt dan ujian tetap sama sehingga hasil kembali ke rekap asal.
- Pemulihan biasa mempertahankan semua jawaban lama.
- Durasi di luar 1–1440 menit ditolak tanpa perubahan data.
- Percobaan ulang dengan kunci yang sama tidak menghapus jawaban baru dan tidak menggandakan audit.
- Route Next.js untuk susulan dan heartbeat tersedia dan meneruskan permintaan ke NestJS.
- Warna serta style Excel terkonfirmasi tersimpan di `styles.xml` berkas XLSX.
- TypeScript API dan web lulus.
- ESLint web penuh lulus tanpa error dan warning.

## Pemeriksaan manual yang disarankan

Pemeriksaan lanjutan menambahkan pembersihan snapshot jawaban, lampiran lokal, dan antrean keamanan ketika browser menerima penanda susulan baru. Hitungan keamanan server juga memakai event susulan sebagai batas awal baru. Uji lint/build sebelumnya mendahului tambahan ini; validasi browser langsung, termasuk tab lama yang masih terbuka dan pengiriman tertunda dari perangkat lain, belum selesai.

1. Selesaikan ujian dengan satu siswa uji, aktifkan susulan 30 menit, lalu pastikan halaman siswa menampilkan attempt kosong dengan tenggat baru.
2. Jawab dan submit ulang, lalu pastikan siswa hanya muncul satu kali pada rekap ujian yang sama dengan nilai baru.
3. Jalankan **Pulihkan** pada siswa lain dan pastikan jawaban lama masih muncul.
4. Unduh Excel dari monitoring, buka `Jawaban_Siswa`, dan periksa satu contoh tiap jenis soal yang digunakan sekolah.
