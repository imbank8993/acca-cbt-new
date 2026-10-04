# Bahan ajar LMS

Menu **Bahan Ajar** membuka `/dashboard/learning`. Guru dan admin dapat membuat draf, mengunggah sumber, memeriksa pratinjau, menyunting HTML hasil konversi, serta menerbitkan materi. Guru mengelola materi miliknya; admin dapat mengelola semua materi dalam sekolah instalasi. Siswa melihat semua materi terbit di sekolahnya dan dapat menandai materi selesai dipelajari. Progres disimpan per akun.

Halaman baca memakai seluruh area layar tanpa sidebar/header/navigasi bawah Dashboard. Bilah kontrol ringkas menyediakan kembali, informasi, unduhan, edit (pengelola), dan tanda selesai. HTML interaktif memakai tata letak aslinya; area bacanya menyesuaikan ruang layar desktop maupun ponsel.

## Aktivasi

1. Terapkan migrasi `database/migrations/20261004_02_cbt_learning_materials.sql` ke database lingkungan tujuan melalui proses rilis yang biasa digunakan:

   ```sh
   node tools/apply-migrations.js --files=20261004_02_cbt_learning_materials.sql --confirm
   ```

2. Pastikan konfigurasi Cloudflare R2 backend sudah tersedia seperti pada fitur unggahan CBT. Batas unggahan 25 MB; reverse proxy juga harus mengizinkan ukuran multipart ini dan JSON hingga batas aplikasi 10 MB.
3. Bangun dan jalankan ulang backend/frontend melalui skrip npm proyek. Hook `predev`/`prebuild` menyalin worker PDF.js dari versi terpasang ke aset publik LMS agar versi pembaca dan worker selalu sama. Jika menjalankan Next langsung, jalankan `node tools/prepare-learning-pdf.cjs` terlebih dahulu. Tabel tidak dibuat otomatis ketika API diakses.
4. Uji sebagai guru: tambah materi → unggah → periksa → terbitkan. Uji sebagai siswa: buka materi, unduh sumber, dan tandai selesai. Simpan kembali sebagai draf untuk menarik materi dari daftar siswa atau mengganti berkas.

Migrasi hanya menambahkan dua tabel dan indeks. Tidak mengubah tabel ujian. Kode fitur dan tes tidak dengan sendirinya menerapkan migrasi atau melakukan deployment.

## Jenis dokumen

| Sumber | Hasil |
| --- | --- |
| `.docx`, `.dotx` | Konversi menjadi HTML, dengan judul, paragraf, daftar, tabel, dan gambar yang didukung Mammoth. Daftar isi dibuat dari heading. |
| `.tex`, `.latex` | Konversi struktur dokumen umum dan rumus menjadi HTML/MathML. Mendukung judul, section/subsection, daftar, verbatim, tabular sederhana, dan persamaan termasuk align. |
| `.html`, `.htm` | Halaman interaktif terisolasi; JavaScript/CSS tertanam dapat berjalan. |
| PDF, gambar raster, audio, video | Pratinjau sesuai kemampuan browser serta unduhan sumber. |
| Teks, Markdown, CSV, JSON | Teks yang dapat dibaca langsung, bukan eksekusi kode. Markdown ditampilkan sebagai teks. |
| Jenis berkas lainnya | Lampiran unduhan. Termasuk Word lama `.doc`/`.dot`, arsip, dan format yang belum memiliki pratinjau. |

Konversi Word menyusun ulang isi untuk layar, bukan meniru tata letak cetak secara persis. Word lama harus disimpan ulang menjadi DOCX/DOTX untuk konversi. Rumus Word, objek tertanam, dan fitur Word khusus harus diperiksa pada pratinjau; sumber asli tetap tersedia.

LaTeX dibaca dengan parser terbatas, bukan compiler TeX. Paket, makro khusus, TikZ, gambar dari berkas pendamping, input/include, dan perintah shell tidak dijalankan. Perintah yang belum didukung ditampilkan dengan catatan konversi, bukan diam-diam dianggap berhasil. Batas sumber LaTeX 500.000 karakter; hasil HTML maksimal 6 juta karakter. Rumus menggunakan [opsi KaTeX](https://katex.org/docs/options.html) dengan `trust: false` dan pembatas ekspansi. Konversi Word menggunakan [Mammoth](https://github.com/mwilliamson/mammoth.js/) dengan akses berkas eksternal dimatikan.

Dokumen Word/LaTeX menjadi halaman baca dengan navigasi bagian dan progres selesai. Kuis atau simulasi tidak dibuat otomatis dari isi dokumen; gunakan HTML untuk aktivitas khusus. Template HTML menyediakan contoh aktivitas dan umpan balik. Hasil kuis di dalam HTML tidak dikirim menjadi nilai CBT dan tidak tersimpan setelah halaman dimuat ulang.

## Penyimpanan dan isolasi

- API NestJS menegakkan peran, sekolah, kepemilikan, dan status terbit. Identitas pemilik/progres tidak berasal dari browser.
- File sumber di R2 menggunakan key acak `lms-private/.../*.bin` dan tipe `application/octet-stream`. API penyimpanan publik menolak prefix ini. URL/key R2 tidak diberikan ke UI; unduhan menggunakan endpoint LMS berautentikasi, tanpa cache publik dan dengan `Content-Disposition: attachment`.
- Jika bucket R2 juga memiliki domain publik langsung, atur domain tersebut agar **tidak menyajikan prefix `lms-private/`** atau gunakan bucket privat sesuai kebijakan instalasi. Pembatasan API tidak mengubah konfigurasi akses bucket itu sendiri.
- HTML hanya ditampilkan di iframe sandbox tanpa `allow-same-origin`, popup, formulir, unduhan otomatis, atau navigasi halaman induk. CSP menolak jaringan, iframe, objek tertanam, dan sumber eksternal. Materi HTML perlu mandiri: skrip/gaya tertanam dan aset data URI. Penyimpanan/cookie aplikasi tidak tersedia di iframe.
- HTML hasil Word/LaTeX disanitasi sebelum dimasukkan ke iframe, dengan JavaScript dinonaktifkan.
- Revisi optimistis mencegah tab lama menimpa perubahan. Berkas hanya diganti pada draf. Jika penyimpanan metadata gagal, unggahan baru dibersihkan dan sumber lama dipertahankan.

## Validasi

```sh
node --test --test-isolation=none apps/api/test/learning-stage80.test.cjs
node node_modules/typescript/bin/tsc --noEmit --incremental false -p apps/api/tsconfig.json
node node_modules/typescript/bin/tsc --noEmit --incremental false -p apps/web/tsconfig.json
node tools/test-learning-browser.cjs
```

Tes browser memerlukan frontend lokal di port 3008, konfigurasi JWT frontend lokal, dan Edge/Chrome/Chromium. Semua endpoint `/api/*` memakai data tiruan; tidak menulis ke database atau R2. Tes mencakup unggah/konversi Word dan LaTeX, interaksi serta isolasi HTML, penerbitan, progres siswa, pencarian, dan layar ponsel. Screenshot disimpan di direktori sementara OS `acca-lms-browser`.
