# Audit peserta monitoring — 14 Oktober 2026

## Data yang ditemukan

Ujian terbaru, **Matematika Dasar 1**, memiliki 12 target kelas dengan total 216 siswa unik. Saat pemeriksaan, 204 pengerjaan berstatus `in_progress`; tidak ada yang melewati batas waktu personal plus toleransi satu menit. Sisanya 12 belum memulai.

Data peserta tersimpan. Tidak ditemukan pembatasan jumlah baris 100/200/216 pada query daftar monitoring. Backend PostgreSQL tidak menggunakan cap PostgREST.

## Hambatan pada kode sebelumnya

1. Endpoint daftar peserta terlebih dahulu menjalankan `finalizeExpired`. Fungsi tersebut membaca semua pengerjaan aktif, lalu membuka transaksi, mengambil lock, membaca ulang sesi, dan membaca jam database **untuk setiap siswa**, termasuk sesi yang masih memiliki waktu. Untuk 204 siswa aktif, ini berarti ratusan query sebelum daftar dikembalikan.
2. Permintaan GET frontend dibatasi 15 detik. Beban pemeriksaan sesi dapat melampaui batas tersebut, terutama ketika banyak pengawas melakukan penyegaran bersamaan. Audit ini tidak merekam permintaan browser yang pertama kali gagal, sehingga kejadian timeout spesifik tersebut merupakan diagnosis dari alur kode dan beban sesi, bukan kutipan log HTTP.
3. Frontend menunggu daftar peserta dan analisis soal bersama-sama sebelum menampilkan daftar. Analisis soal memanggil layanan penskoran, termasuk analisis mendetail yang memiliki batas waktu 30 detik. Daftar peserta dapat tertahan meskipun datanya sudah tersedia.
4. Helper daftar mengubah permintaan gagal menjadi `[]`. Beberapa halaman menampilkan daftar kosong atau hanya mencatat kesalahan ke konsol.
5. Penyegaran berkala dapat dimulai ketika permintaan sebelumnya belum selesai, menambah beban dan menyebabkan respons lama tertimpa.
6. Query kelas dan peserta perorangan mengabaikan kegagalan baca. Peserta tanpa baris profil juga dapat hilang dari daftar peserta perorangan.

## Perbaikan

- Pemeriksaan batas waktu membaca jam database sekali dan menyaring kandidat kedaluwarsa terlebih dahulu. Transaksi dan pemeriksaan terkunci hanya dilakukan untuk kandidat yang waktunya benar-benar sudah habis. Pemeriksaan ulang di dalam lock tetap mempertahankan perlindungan terhadap reset proktor, masa toleransi, sesi pemulihan, dan pengumpulan yang sedang berlangsung.
- Daftar peserta langsung dimasukkan ke tampilan begitu permintaan roster selesai; tidak menunggu analisis soal.
- Analisis soal pada halaman admin, proktor, dan guru hanya dimuat ketika tab analisis dibuka. Batas waktu khusus analisis disesuaikan dengan pekerjaan layanan penskoran.
- Penyegaran otomatis melewati permintaan baru jika ujian yang sama masih dimuat. Respons lama tidak mengubah data setelah pengguna berpindah ujian.
- Kegagalan pengambilan daftar tidak lagi diubah menjadi daftar kosong. Admin, proktor, dan guru memiliki pesan kesalahan; helper bersama mengembalikan kegagalan melalui exception bagi pemanggil lain.
- Kegagalan membaca kelas, anggota kelas, dan peserta perorangan dinyatakan jelas. Peserta perorangan tanpa profil tetap memiliki baris “belum”.

## Verifikasi

- Service daftar beserta adapter PostgreSQL diuji terhadap ujian tersebut dalam transaksi `READ ONLY`. Jalur mutasi lifecycle ditolak oleh shim audit dan retry penilaian tidak dijalankan.
- Hasil: **216 peserta**, terdiri dari **204 sedang mengerjakan** dan **12 belum mulai**; 16 query, sekitar **3.97 detik** pada pemeriksaan tersebut, termasuk pemuatan registry skema. Waktu ini adalah satu pengukuran diagnostik, bukan jaminan latensi semua permintaan.
- Pengujian 216 siswa memastikan tidak ada transaksi per siswa untuk sesi yang belum kedaluwarsa.
- Pengujian 620 siswa memastikan daftar tidak dipotong oleh ukuran batch.
- Pengujian kedaluwarsa, toleransi, pengumpulan aktif, kegagalan membaca roster, profil peserta yang hilang, serta perlindungan reset lifecycle lulus.
- Seluruh 40 pengujian terkait lulus; pemeriksaan tipe frontend dan backend lulus. Lint tidak menemukan error; beberapa peringatan variabel tidak terpakai sudah ada pada halaman monitoring sebelumnya.
- Data jawaban, izin peserta, nilai, dan status sesi nyata tidak diubah oleh audit. Tidak dilakukan restart layanan selama ujian berjalan.

## Berkas

- `apps/api/src/proctor/exam-monitoring.service.ts`
- `apps/api/test/monitoring-roster-scale.test.cjs`
- `apps/web/lib/api/proctor.ts`
- `apps/web/app/dashboard/admin/monitoring/page.tsx`
- `apps/web/app/dashboard/proktor/monitoring/page.tsx`
- `apps/web/app/dashboard/guru/monitoring/page.tsx`
