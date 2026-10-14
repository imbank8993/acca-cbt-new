# Hasil validasi pada akun penyusun bank soal

## Temuan

Audit baca database lokal menemukan hasil validasi bank "Fundamental Matematika 1" milik Nurmadinah dengan status `revision_needed`, satu catatan, dan satu validator yang sudah mengirim hasil. Tidak ditemukan notifikasi untuk sesi tersebut pada akun penyusun.

Hasil dikirim pada 13 Oktober 2026 pukul 19.08 WITA. Fitur notifikasi penyusun baru masuk dalam commit `654df97` pada pukul 19.59 WITA. Hasil lama tidak otomatis mendapat notifikasi. Pengiriman ulang dengan rekomendasi identik sebelumnya juga melewati pembuatan notifikasi.

Catatan sudah dapat dibaca lewat tab Catatan Validasi dan panel editor, tetapi halaman daftar soal tidak memberikan ringkasan yang menarik perhatian penyusun. Menu Validasi Soal milik guru memuat tugas sebagai validator, bukan hasil untuk bank soal yang disusunnya.

## Perbaikan

- Halaman daftar soal menampilkan ringkasan seluruh sesi validasi, nomor soal yang perlu diperbaiki, bagian yang ditandai, kutipan, catatan, dan tombol membuka editor atau riwayat sesi.
- Pengiriman ulang rekomendasi atau keputusan identik memeriksa apakah notifikasi penyusun sudah ada. Jika belum ada, notifikasi dibuat dalam transaksi yang sama. Pengiriman ulang berikutnya tidak menambah duplikat.
- Inisialisasi panel catatan aman saat `window` belum tersedia.

Tidak ada perubahan pada catatan, hasil validasi, atau notifikasi database saat pemeriksaan ini. Perbaikan berlaku setelah versi aplikasi diperbarui; pemulihan notifikasi lama terjadi ketika validator mengirim ulang hasil atau admin mengirim ulang keputusan yang sama.

## Verifikasi

Tes alur validasi memeriksa pemulihan notifikasi lama, deduplikasi, izin akses, dan rollback. Tes interaksi ringkasan memeriksa catatan pada soal yang tepat, penyembunyian catatan valid/sudah diperbaiki, serta pembukaan editor dan sesi validasi. Pemeriksaan tipe dijalankan untuk frontend dan backend.
