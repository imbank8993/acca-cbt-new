# Perbaikan integritas ujian — 10 Oktober 2026

## Perubahan

1. Penilaian ulang menghentikan proses bila pembacaan jawaban/ujian gagal. Nilai terakhir tidak diganti dengan nol.
2. Opsi yang dirujuk snapshot tidak dapat dihapus meskipun belum pernah dipilih siswa. Pembentukan snapshot mengunci soal dan membaca ulang opsi setelah edit serentak selesai. Soal bersnapshot hanya dihapus secara logis agar referensi jawaban tetap tersedia. Edit bank tidak lagi memperbarui snapshot ujian atau memicu regrade otomatis. Ujian yang sudah dibekukan tetap menggunakan soal, bobot, dan kuncinya. Layar penilaian guru juga menggunakan snapshot tersebut.
3. Penilaian dari jawaban tersimpan hanya berlaku pada attempt selesai. Status, waktu mulai/selesai, dan isi jawaban diperiksa ulang setelah scoring. Reset membatalkan penerapan hasil lama.
4. Nilai esai memperbarui base score dan total secara atomik, lalu menghitung kembali skor relatif kuis. Kegagalan scoring relatif menyisakan penanda untuk dicoba kembali oleh worker.
5. Nilai per jawaban dan total disimpan dalam satu transaksi. Setiap error penulisan menyebabkan rollback.
6. Resume yang gagal membaca jawaban mengembalikan error retryable, bukan daftar jawaban kosong.
7. Endpoint soal dan polling memeriksa ID perangkat yang terikat pada attempt. Browser dan proxy meneruskannya secara konsisten; perangkat berbeda atau identitas kosong ditolak.
8. Penilaian esai memeriksa ulang generasi attempt setelah mendapat row lock dan menolak sesi yang berubah. Penilaian manual menunggu scoring otomatis selesai agar tidak menjumlahkan nilai objektif yang belum dihitung.
9. Jalur auto-submit/retry membuat baris esai kosong secara idempoten sehingga guru dapat menilainya, termasuk memberi nol. Nilai manual yang masuk bersamaan dengan regrade tetap diperhitungkan.
10. Worker backend mencoba nilai tertunda tanpa membutuhkan halaman monitoring, dengan pemeriksaan setiap 30 detik bila tidak sedang memproses batch, batas batch 25, timeout scoring 15 detik, dan backoff kegagalan sampai 5 menit. Worker juga menyelesaikan perhitungan relatif yang tertunda.

Perbaikan tambahan terkait balapan:

- Jalur submit awal tidak menimpa nilai yang sudah disimpan worker atau nilai manual yang menyusul.
- Penerapan skor relatif mengunci dan memeriksa ulang kelompok peserta sebelum menulis; hasil dari kelompok yang berubah dibatalkan.
- Penutupan otomatis mengosongkan total untuk menandainya sebagai pekerjaan penilaian tertunda. Pemanggil tidak lagi menulis ulang total di luar transaksi grading.
- Reset membersihkan jadwal retry dan penanda nilai relatif dari generasi lama.

## Pengujian

Regression test baru: `apps/api/test/exam-audit-fixes-stage87.test.cjs` (21 skenario), termasuk kegagalan database, reset saat grading, skor dasar kuis, esai kosong, header perangkat, worker tanpa monitoring, backoff, dan hasil submit lama.

Skrip `node tools/audit-exam-findings-20261010.cjs` menjalankan regression test tersebut; tidak mengakses database produksi. Rangkaian audit Node juga memasukkan file baru ini.

Pemeriksaan tipe backend dan frontend lulus. Pengujian mesin skor Python: 167 lulus. Seluruh 494 pengujian audit Node lulus, termasuk 21 skenario baru. Pengujian Node dilakukan dalam kelompok kecil karena satu proses untuk seluruh suite mencapai batas heap; test backup dijalankan terpisah untuk menghindari benturan konfigurasi transpiler antarfile saat isolasi subprocess tidak tersedia. Selain itu, 47 pemeriksaan impor/ekspor soal dan 13 pemeriksaan service soal lulus. Fixture penilaian lama diperbarui mengikuti tanggung jawab baru service grading yang menyimpan total secara atomik.

## Penerapan dan batasan

- Perubahan ada di workspace; belum deploy atau mengubah database produksi. Deploy frontend dan backend bersama karena endpoint soal sekarang mewajibkan identitas perangkat.
- Migrasi `database/migrations/20261010_01_grading_retry_indexes.sql` menyediakan indeks antrean. Ini optimasi kinerja, bukan kolom baru yang wajib ada untuk menjalankan kode. Migrasi belum dijalankan pada database aktif.
- Tidak ada penghitungan ulang massal nilai lama. Nilai historis yang sebelumnya sudah terdampak perlu diaudit terhadap sumber kunci dan jawaban yang sah; kode tidak menebak nilai yang seharusnya.
- ID perangkat masih identitas profil browser yang dikirim klien, bukan bukti perangkat keras. Menyalin ID bersama akses akun tetap menjadi batasan model keamanan ini. Perbaikan menutup akses soal tanpa pemeriksaan perangkat, tetapi tidak mengklaim mencegah berbagi akun secara sengaja atau pemindahan seluruh profil browser.
- Pengujian race memakai fixture deterministik, bukan PostgreSQL dan dua browser langsung. Uji beban, konfigurasi reverse proxy/rate limiting, dan audit dependensi tetap belum dilakukan.
