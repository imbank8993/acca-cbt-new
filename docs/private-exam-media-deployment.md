# Penerapan perlindungan soal dan kunci

Kode aplikasi memisahkan `show_results` (nilai) dari `metadata.show_answer_keys` (kunci/pembahasan). Kunci memerlukan keduanya aktif, jadwal akhir yang valid sudah lewat, dan tidak ada sesi dengan waktu pengerjaan/pemulihan tersisa. Ujian lama tidak otomatis membuka kunci. Rincian hasil tetap membaca kunci terbaru dari bank sesuai kebutuhan sekolah.

Lampiran privat menggunakan proxy sesi, pemeriksaan pemilik/hak akses, dan `private, no-store`. URL lama dari domain R2 yang dikonfigurasi dinormalisasi dalam respons API. Logo/avatar tetap publik melalui proxy. Cache service worker lama dibersihkan saat versi baru aktif.

## Wajib saat penerapan produksi

1. Nonaktifkan akses publik bucket R2: domain r2.dev dan semua custom domain yang mengekspos bucket. Pertahankan akses S3 server dengan kredensial yang sudah ada. Bila branding harus memakai CDN, pisahkan bucket publik khusus branding; jangan publikasikan bucket soal.
2. Purge cache CDN/reverse proxy untuk URL media lama, termasuk `/api/storage/file/*` dan salinan optimizer gambar. Browser yang sudah mengunduh berkas tidak dapat ditarik kembali oleh server.
3. Pertahankan `CLOUDFLARE_R2_PUBLIC_URL` lama untuk pengenalan URL tersimpan (tidak dipakai untuk membuat URL privat baru). Logo/avatar baru dan URL lama yang dikenali juga melalui proxy; keduanya tetap dapat dibaca publik tanpa mempublikasikan bucket. Inventarisasi URL domain lama lain yang tidak sesuai konfigurasi dan migrasikan ke proxy sebelum menutup domain.
4. Deploy API dan web bersamaan. Periksa: tanpa login URL soal harus ditolak, peserta aktif boleh mengambil gambar soal miliknya, gambar pembahasan ditolak sebelum rilis, dan guru pemilik tetap dapat melihat draf.
5. Periksa URL langsung lama dari jaringan luar: harus tidak lagi mengembalikan isi soal. Perubahan aplikasi saja tidak menutup akses langsung bucket/CDN.

Konfigurasi cloud, purge CDN, dan deployment produksi tidak dilakukan oleh perubahan kode lokal ini.
