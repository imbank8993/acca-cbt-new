# Bahan ajar LMS

Menu **Bahan Ajar** membuka `/dashboard/learning`. Guru dan admin dapat membuat draf, mengunggah sumber, memeriksa pratinjau, menyunting HTML hasil konversi, serta menerbitkan materi. Guru mengelola materi miliknya; admin dapat mengelola semua materi dalam sekolah instalasi. Siswa melihat semua materi terbit di sekolahnya dan dapat menandai materi selesai dipelajari. Progres disimpan per akun.
b
Halaman baca memakai seluruh area layar tanpa sidebar/header/navigasi bawah Dashboard. Bilah kontrol ringkas menyediakan kembali, informasi, unduhan, edit (pengelola), dan tanda selesai. HTML interaktif memakai tata letak aslinya; area bacanya menyesuaikan ruang layar desktop maupun ponsel.

## Aktivasi

1. Terapkan migrasi `database/migrations/20261004_02_cbt_learning_materials.sql` ke database lingkungan tujuan melalui proses rilis yang biasa digunakan:

   ```sh
   node tools/apply-migrations.js --files=20261004_02_cbt_learning_materials.sql --confirm
   ```

2. Pastikan konfigurasi Cloudflare R2 backend sudah tersedia seperti pada fitur unggahan CBT. Batas unggahan 25 MB; reverse proxy juga harus mengizinkan ukuran multipart ini dan JSON hingga batas aplikasi 10 MB.
3. Bangun dan jalankan ulang backend/frontend melalui skrip npm proyek. Hook `predev`/`prebuild` menyalin worker PDF.js dari versi terpasang ke aset publik LMS agar versi pembaca dan worker selalu sama. Jika menjalankan Next langsung, jalankan `node tools/prepare-learning-pdf.cjs` terlebih dahulu. Tabel tidak dibuat otomatis ketika API diakses.
4. Uji sebagai guru: tambah materi → unggah → periksa → terbitkan. Uji sebagai siswa: buka materi, unduh sumber, dan tandai selesai. Simpan kembali sebagai draf untuk menarik materi dari daftar siswa atau mengganti berkas.

Terapkan juga `node tools/apply-migrations.js --files=20261005_01_learning_resilience.sql --confirm` untuk penyimpanan aktivitas dan versi materi. Migrasi LMS tidak mengubah tabel ujian. Kode fitur dan tes tidak dengan sendirinya melakukan deployment.

## Jenis dokumen

| Sumber | Hasil |
| --- | --- |
| `.docx`, `.dotx` | Konversi menjadi HTML, dengan judul, paragraf, daftar, tabel, dan gambar yang didukung Mammoth. Daftar isi dibuat dari heading. |
| `.tex`, `.latex`, ZIP proyek dengan `main.tex` | Kompilasi menjadi PDF dengan pdfLaTeX/XeLaTeX; margin, halaman, header/footer, tabel, rumus, dan TikZ mengikuti sumber. File TeX asli tetap tersedia. |
| `.html`, `.htm` | Halaman interaktif terisolasi; JavaScript/CSS tertanam dapat berjalan. |
| PDF, gambar raster, audio, video | Pratinjau sesuai kemampuan browser serta unduhan sumber. |
| Teks, Markdown, CSV, JSON | Teks yang dapat dibaca langsung, bukan eksekusi kode. Markdown ditampilkan sebagai teks. |
| Jenis berkas lainnya | Lampiran unduhan. Termasuk Word lama `.doc`/`.dot`, arsip selain ZIP proyek, dan format yang belum memiliki pratinjau. |

Konversi Word menyusun ulang isi untuk layar, bukan meniru tata letak cetak secara persis. Word lama harus disimpan ulang menjadi DOCX/DOTX untuk konversi. Rumus Word, objek tertanam, dan fitur Word khusus harus diperiksa pada pratinjau; sumber asli tetap tersedia.

LaTeX baru dikompilasi oleh layanan terisolasi `cbt-latex`, bukan parser HTML. Batas sumber 500 KB (UTF-8), PDF 25 MB, hingga tiga pass untuk referensi/daftar isi. Compiler bawaan pdfLaTeX; `fontspec`/`polyglossia` menggunakan XeLaTeX. Directive `% !TeX program = xelatex` atau `pdflatex` dapat menentukan engine. Unggah proyek ZIP dengan `main.tex` di folder teratas untuk menyertakan gambar, bagian `.tex`, kelas, dan font lokal. Berkas atau paket yang tidak tersedia menghasilkan galat kompilasi. Bibliografi yang memerlukan proses BibTeX/Biber terpisah belum dijalankan otomatis. Engine dan font yang sama dengan sumber dibutuhkan untuk hasil visual yang sama. Shell escape dan instalasi paket otomatis dinonaktifkan.

Materi LaTeX lama tetap dapat dibaca dalam HTML. Guru perlu menyimpannya sebagai draf dan mengunggah ulang TeX untuk memperoleh PDF asli. Isi PDF diubah dengan mengunggah ulang sumber, bukan menyunting HTML.

Dokumen Word menjadi halaman baca dengan navigasi bagian; LaTeX memakai navigasi halaman PDF. Keduanya memiliki progres selesai. Kuis atau simulasi tidak dibuat otomatis dari isi dokumen; gunakan HTML untuk aktivitas khusus. Hasil aktivitas HTML tersimpan per akun dan versi materi, tetapi tidak otomatis menjadi nilai CBT.

## Jawaban, draf, dan pembaruan

- Input, textarea, pilihan, checkbox, radio, dan pengatur HTML disimpan otomatis. Password, file, hidden, dan elemen `data-lms-ignore` dikecualikan. Gunakan `data-lms-key` yang unik dan tetap pada setiap input jika susunan halaman dinamis.
- Jawaban dicadangkan di perangkat dan dikirim setiap lima detik ketika halaman materi terbuka. Koneksi pulih memicu pengiriman ulang. Membuka kembali materi memulihkan salinan lokal; membaca materi pertama kali tetap memerlukan jaringan. Konflik antar tab tidak menimpa jawaban server secara diam-diam.
- Status JavaScript khusus (misalnya tahap simulasi) perlu disimpan dengan `window.ACCALMS.setState({ tahap: 2 })`. Pulihkan melalui `window.addEventListener('lms:ready', event => { const state = event.detail.state; /* tampilkan state */ })`. API hanya aktif pada halaman baca HTML terbit; gunakan optional chaining agar pratinjau tetap berjalan. Batas total data aktivitas 128 KB.
- Guru/admin membuka **Jawaban aktivitas siswa** di editor untuk melihat maksimal 500 rekaman terbaru, termasuk versi materi sebelumnya.
- Perubahan editor dicadangkan lokal per akun. Materi berstatus draf disimpan otomatis setelah berhenti mengetik; perubahan materi terbit memerlukan tombol **Perbarui materi**. Draf lokal dari revisi berbeda ditawarkan untuk pemulihan manual.
- Unggahan file, informasi materi, dan hasil konversi disimpan dalam satu pembaruan. Jika gagal, file lama tetap digunakan. Pratinjau HTML dan halaman baca memakai aturan CSS yang sama.
- Mengubah isi atau mengganti file membuat versi baru. Siswa yang menyelesaikan versi sebelumnya melihat tanda **Materi diperbarui** dan perlu menandai selesai kembali. Perubahan judul/deskripsi tidak membatalkan progres.

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

## Klasifikasi modul

Jalankan migrasi `20261005_02_learning_classification.sql` untuk kolom tingkatan kelas, materi, dan submateri. Editor menyediakan kelas 1-12 atau semua tingkatan, mata pelajaran, materi, dan submateri. Modul lama tetap lintas kelas. Filter perpustakaan bertingkat dan pencarian mencakup materi/submateri. Klasifikasi tidak membatasi akses siswa dan tidak mengubah versi isi atau status selesai.

## Navigasi halaman baca

Tombol **Navigasi bahan ajar** membuka/menyembunyikan daftar mata pelajaran, materi, submateri, dan modul. Cabang modul aktif terbuka otomatis; modul aktif ditandai dan kelas ditampilkan pada tiap tautan. Sidebar memakai daftar materi terbit yang boleh diakses pengguna; draf yang sedang dibaca pengelola hanya ditambahkan pada navigasinya sendiri. Pada desktop daftar terbuka di sisi kiri, pada ponsel tersembunyi awalnya dan dapat dibuka di atas area baca. Menyembunyikan daftar tidak memuat ulang aktivitas. Perubahan ini tidak memerlukan migrasi.

## Mengaktifkan kompilasi TeX

- Terapkan `node tools/apply-migrations.js --files=20261006_01_learning_rendered_pdf.sql --confirm`.
- Deploy ulang `cbt-api`, `cbt-web`, dan layanan baru `cbt-latex` melalui Compose. Docker belum tersedia di lingkungan Windows pengembangan ini; jangan menjalankan unggahan TeX tak tepercaya langsung menggunakan compiler host.
- Compose memasang TeX Live pada worker tanpa kredensial aplikasi, tanpa volume host, tanpa port publik, dan hanya pada jaringan internal khusus. API memakai `LATEX_RENDERER_URL=http://cbt-latex:8010`. Worker memakai filesystem read-only, temporary filesystem terbatas, satu kompilasi sekaligus, batas CPU/memori/waktu, serta shell escape dimatikan.
- Atur `proxy_read_timeout 90s` pada reverse proxy untuk unggahan kompilasi; batas API ke worker 70 detik. Jika worker tidak tersedia, unggahan TeX menampilkan galat dan materi sebelumnya tetap tersedia.
- Endpoint `/api/learning/:id/pdf` memerlukan sesi dan izin baca yang sama dengan sumber. PDF disajikan lewat canvas agar aksi/script PDF tidak dieksekusi.
- Pemeriksaan: `node --test --test-isolation=none apps/api/test/learning-pdf-stage84.test.cjs` dan `python -m unittest discover -s apps/latex-renderer -p 'test_*.py'`. Dokumen `tools/fixtures/learning-layout.tex` mencakup dua halaman, header/footer, dua kolom, rumus, tabel, makro, dan TikZ.

## Proyek LaTeX bergambar (ZIP)

Unggah ZIP maksimum 25 MB melalui pilihan berkas bahan ajar. `main.tex` (huruf kecil, maksimum 500 KB, UTF-8) wajib berada di folder teratas ZIP, bukan di dalam folder pembungkus. Sertakan gambar PNG/JPG/PDF dan bagian TeX sesuai path sumber, misalnya `main.tex` merujuk `\includegraphics{gambar/grafik.png}` dan arsip berisi `gambar/grafik.png`. Nama/path harus sama persis, termasuk huruf besar-kecil. Kompilasi berjalan dari folder utama proyek.

Batas ekstraksi: 200 berkas, 400 entri, dan 50 MB total; symlink, path keluar folder, berkas terenkripsi, nama duplikat, serta arsip rusak ditolak. Jangan sertakan output compiler (`main.pdf`, `.aux`, `.log`) dalam ZIP. Font lokal TTF/OTF, kelas/style LaTeX dan data TXT/CSV/DAT diperbolehkan. ZIP diperlakukan sebagai proyek LaTeX; ZIP tanpa main.tex tidak lagi menjadi lampiran generik.

Arsip asli tetap bisa diunduh, PDF hasil kompilasi tersedia terpisah. Contoh proyek bergambar: `tools/fixtures/learning-project.zip`. Tidak memerlukan migrasi baru di luar migrasi PDF `20261006_01_learning_rendered_pdf.sql`; layanan API, web, dan `cbt-latex` harus menggunakan kode terbaru.
