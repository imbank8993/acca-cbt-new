# Panduan Deployment ACCA CBT Menggunakan Docker & aaPanel di VPS Ubuntu

Panduan ini menjelaskan konfigurasi dan alur deployment **ACCA CBT** ke server VPS Ubuntu dengan **aaPanel**, Docker Compose, dan otomatisasi CI/CD via **GitHub Actions**.

---

## 1. Arsitektur & Alokasi Port

Arsitektur multi-layanan dirancang agar berdampingan dengan proyek `acca-new` tanpa tabrakan port (*port collision*):

| Layanan | Teknologi | Port Kontainer | Port Host VPS | Keterangan Akses |
|---|---|---|---|---|
| **acca-web** | Next.js | 3000 / 3006 | **3006** | Publik via Nginx aaPanel |
| **acca-api** | Express / Nest | 3001 / 3007 | **3007** | Publik via Nginx aaPanel |
| **cbt-web** | Next.js Standalone | 3008 | **3008** | **Publik via Nginx aaPanel (Reverse Proxy)** |
| **cbt-api** | NestJS 10 | 3009 | *Tidak diekspos* | Internal Docker network (`cbt-network`) |
| **cbt-scoring**| FastAPI / Python | 8000 | *Tidak diekspos* | Internal Docker network (`cbt-network`) |
| **PostgreSQL** | PostgreSQL 16 | 5432 | 5432 (Host) | Diakses lewat `host.docker.internal:5432` |

---

## 2. Persiapan Awal di VPS (aaPanel)

### A. Clone Repositori Perdana
Masuk ke terminal VPS via SSH, lalu jalankan:

```bash
cd /www/wwwroot/
git clone https://github.com/imbank8993/acca-cbt-new.git
cd acca-cbt-new
```

### B. Konfigurasi Lingkungan (`.env`)
Salin file template `.env.example` menjadi `.env`:

```bash
cp .env.example .env
nano .env
```

Pastikan variabel penting berikut disesuaikan:
1. **`DATABASE_URL`**: Hubungkan ke PostgreSQL di host VPS:
   ```env
   DATABASE_URL="postgresql://postgres:password_db_anda@host.docker.internal:5432/acca_db?schema=public"
   ```
   Pool koneksi API diatur lewat `DB_CONNECTION_LIMIT` (bawaan 30) dan `DB_POOL_TIMEOUT`
   (bawaan 20 detik), kecuali `DATABASE_URL` sudah memuat `connection_limit`/`pool_timeout`.
   Tanpa ini Prisma hanya membuka ~13 koneksi di VPS 6 core, yang habis saat ratusan siswa
   mengumpulkan ujian serentak. Jaga total koneksi semua aplikasi di bawah `max_connections`
   PostgreSQL (`SHOW max_connections;`, bawaan 100).
2. **`JWT_SECRET` & `CBT_SSO_SECRET`**:
   Wajib sama persis dengan yang ada di `.env` project `acca-new` agar token login SSO kompatibel.
3. **`NEXT_PUBLIC_SITE_URL` & `NEXT_PUBLIC_ACCA_URL`**:
   Atur domain produksi (mis. `https://cbt.domainanda.sch.id` dan `https://app.domainanda.sch.id`).
4. **`CLOUDFLARE_R2_*`**:
   Kredensial bucket Cloudflare R2 untuk penyimpanan berkas ujian/audio/gambar.

Simpan perubahan (`Ctrl+O` lalu Enter, `Ctrl+X`).

### C. Build & Jalankan Kontainer Pertama Kali
```bash
docker compose up -d --build
```
Periksa status kontainer:
```bash
docker compose ps
```
Pastikan ketiga service (`cbt-web`, `cbt-api`, `cbt-scoring`) berstatus `Up`.

---

## 3. Konfigurasi Domain, Reverse Proxy & SSL di aaPanel

1. Buka dashboard **aaPanel** (mis. `http://194.233.81.192:8888`).
2. Masuk ke menu **Website** -> Klik tombol **Add site**.
3. Isi form:
   - **Domain**: Masukkan domain CBT Anda, misalnya `cbt.domainanda.sch.id`.
   - **Type**: Pilih **Pure Static**.
   - Klik **Submit**.
4. Setelah website terbuat, klik nama domain tersebut untuk membuka panel pengaturannya:
   - **Reverse Proxy**:
     1. Klik tab **Reverse Proxy** -> Klik **Add reverse proxy**.
     2. Proxy Name: `cbt-proxy`
     3. Target URL: `http://127.0.0.1:3008`
     4. Sent Host: `$host`
     5. Klik **Save**.
   - **SSL Certificate**:
     1. Klik tab **SSL** -> Pilih tab **Let's Encrypt**.
     2. Centang nama domain Anda, klik **Apply**.
     3. Setelah berhasil terbit, aktifkan tombol **Force HTTPS**.
5. Uji akses domain Anda di peramban: `https://cbt.domainanda.sch.id`.

---

## 4. Konfigurasi CI/CD Otomatis via GitHub Actions

Workflow otomatis sudah disiapkan di [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml).

### Menambahkan GitHub Secrets
Buka repositori Anda di GitHub -> **Settings** -> **Secrets and variables** -> **Actions** -> Klik **New repository secret**:

| Nama Secret | Nilai | Keterangan |
|---|---|---|
| `VPS_HOST` | `194.233.81.192` | Alamat IP VPS Anda |
| `VPS_USERNAME` | `root` | Username SSH VPS |
| `VPS_SSH_KEY` | *(Konten Private SSH Key)* | Private key dari pasangan kunci yang ada di VPS `~/.ssh/authorized_keys` |
| `VPS_PORT` | `22` *(Opsional)* | Port SSH jika bukan port standar 22 |
| `VPS_APP_DIR` | `/www/wwwroot/acca-cbt-new` | Path root proyek (sudah menjadi default) |

### Alur Kerja CI/CD
Setiap kali Anda menjalankan `git push origin master` (atau `main`):
1. **Tahap Verifikasi (Verify Job)**:
   - Menjalankan `npm ci`, kompilasi paket shared `@acca-cbt/shared`.
   - Meng-generate Prisma Client.
   - Typecheck frontend Next.js (`npm run typecheck`).
   - Kompilasi backend NestJS (`npm run build:backend`).
   - Menjalankan unit tests scoring Python via `pytest`.
2. **Tahap Build Image (Build Images Job)** — berjalan di server GitHub, **bukan di VPS**:
   - Membangun 4 image (`web`, `api`, `scoring`, `latex`) secara paralel dengan cache.
   - Menyimpannya di GitHub Container Registry (privat, mengikuti repo):
     `ghcr.io/imbank8993/acca-cbt-new-<layanan>:<commit>` dan `:latest`.
3. **Tahap Deploy (Deploy Job)**:
   - Menghubungi VPS via SSH aman, `git fetch` & `git reset --hard` ke commit terbaru.
   - Login GHCR sementara dengan token job, `docker compose pull` image versi commit itu, lalu logout.
   - Menandai image itu sebagai `:latest` di VPS, lalu `docker compose up -d --no-build --remove-orphans`.
     Hanya kontainer yang berubah yang dibuat ulang (beberapa detik).
   - Menyimpan 3 versi terakhir per layanan untuk rollback, sisanya dihapus.

Dengan ini CPU VPS tidak lagi penuh 10–20 menit setiap push. Deploy masih membuat ulang kontainer
beberapa detik, jadi sebaiknya tetap tidak push saat ujian sedang ramai.

### Variabel build (opsional)
`NEXT_PUBLIC_SITE_URL` dan `NEXT_PUBLIC_ACCA_URL` tertanam saat build. Bawaannya
`https://acca-cbt.icgowa.sch.id` dan `https://acca.icgowa.sch.id`. Bila domain berubah, isi
**Settings → Secrets and variables → Actions → Variables** dengan nilai yang sama seperti `.env` VPS.

### Rollback ke versi sebelumnya (di VPS)
```bash
cd /www/wwwroot/acca-cbt-new
docker images | grep acca-cbt-new-api        # lihat tag commit yang tersedia
CBT_IMAGE_TAG=<commit-sebelumnya> docker compose up -d --no-build
```

### Build darurat langsung di VPS
Bila GitHub Actions/GHCR tidak tersedia, `docker compose build && docker compose up -d` tetap bisa
dipakai (bagian `build:` di `docker-compose.yml` dipertahankan). Ini memakan CPU VPS seperti dulu.

---

## 5. Perintah Pemeliharaan Berguna di VPS

```bash
# Masuk ke folder proyek
cd /www/wwwroot/acca-cbt-new

# Melihat log langsung (live stream)
docker compose logs -f

# Melihat log service tertentu
docker compose logs -f cbt-web
docker compose logs -f cbt-api
docker compose logs -f cbt-scoring

# Restart kontainer tertentu jika diperlukan
docker compose restart cbt-web
docker compose restart cbt-api

# Melihat penggunaan resource RAM/CPU kontainer
docker stats
```


## Perbaikan sesi SSO dan HTTPS (5 Oktober 2026)

Pada domain CBT produksi, HTTP harus dialihkan di aaPanel/Nginx **sebelum** mencapai Next.js. Jangan mengalihkan berdasarkan protokol koneksi internal Docker: koneksi Nginx ke port 3008 memang HTTP, walaupun browser memakai HTTPS.

1. Set `NEXT_PUBLIC_SITE_URL=https://acca-cbt.icgowa.sch.id` dan `NEXT_PUBLIC_ACCA_URL=https://acca.icgowa.sch.id` pada `.env` VPS. Nilai build dan runtime harus sama. Bawaan domain lama `accav2-cbt` sudah diganti.
2. Aktifkan **Force HTTPS** di SSL situs aaPanel. HTTP port 80 harus mengembalikan 301/308 ke `https://acca-cbt.icgowa.sch.id$request_uri`, bukan menyajikan halaman login dengan status 200. Pertahankan pengecualian ACME yang dikelola panel.
3. Pada lokasi reverse proxy situs TLS, pastikan header berikut ditetapkan Nginx, bukan diteruskan mentah dari klien:

   ```nginx
   proxy_set_header Host $host;
   proxy_set_header X-Forwarded-Host $host;
   proxy_set_header X-Forwarded-Proto https;
   proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
   ```

   `https` di sini khusus lokasi yang menerima trafik HTTPS setelah pengalihan HTTP. Untuk TLS yang berakhir di proxy lain, atur rantai proxy tepercaya agar menyampaikan protokol browser secara benar.
4. Periksa `nginx -t` sebelum reload Nginx, lalu rilis kode ini dan bangun ulang `cbt-web` dengan konfigurasi tersebut. Restart tanpa build tidak memperbarui variabel `NEXT_PUBLIC_*` yang tertanam.
5. Verifikasi tanpa akun: HTTP `/` beralih ke HTTPS; HTTPS `/api/auth/sso` tanpa tiket beralih ke **HTTPS** `/?error=missing-token`; HTTPS `/dashboard/siswa` tanpa sesi beralih ke **HTTPS** `/`. Selanjutnya uji tombol CBT dari ACCA pada browser bermasalah.

Kode baru memakai `__Host-cbt_session` (Secure, HttpOnly, Path=/, tanpa Domain) untuk login produksi sehingga cookie `cbt_session` lama tidak mengalahkannya. Sesi lama tetap dapat dibaca sampai login berikutnya; logout menghapus kedua nama. Jangan menonaktifkan Secure atau membagikan cookie ke semua subdomain untuk mengatasi masalah ini. Respons auth tidak boleh dicache reverse proxy/CDN. Middleware mengirim HSTS untuk host CBT pada produksi.

Tidak ada migrasi database. Mengubah kode lokal belum menerapkan Force HTTPS atau merilis perubahan ke VPS.

## Renderer LaTeX bahan ajar (6 Oktober 2026)

Rilis ini menambahkan service internal `cbt-latex`. Terapkan migrasi `20261006_01_learning_rendered_pdf.sql`, kemudian build dan jalankan ulang `cbt-latex`, `cbt-api`, serta `cbt-web`. Build pertama memasang paket TeX Live dan lebih besar dari service API. Compose membatasi worker tanpa akses internet, tanpa kredensial, dan tanpa port publik. API memperoleh `LATEX_RENDERER_URL` dari Compose; instalasi di luar Compose harus menyediakan worker terisolasi yang setara.

Pada reverse proxy, gunakan `proxy_read_timeout 90s` untuk memungkinkan kompilasi tiga pass (maksimum 60 detik). Jika compiler tidak tersedia atau sumber memiliki kesalahan, unggahan dibatalkan dengan pesan galat; materi yang sudah tersimpan tidak diganti. Materi TeX lama perlu diunggah ulang agar memperoleh PDF. Lihat `docs/LMS.md` untuk engine dan batas dokumen.

## Kapasitas ujian serentak (8 November 2026)

Rilis ini membuat penilaian submit berjalan paralel dan menambah pool koneksi Prisma
(`DB_CONNECTION_LIMIT`, bawaan 30). Setelah rilis ter-deploy, jalankan di VPS:

```bash
cd /www/wwwroot/acca-cbt-new
bash tools/vps/cbt-kapasitas.sh cek        # hanya membaca: kode, PostgreSQL, pool, rekomendasi
bash tools/vps/cbt-kapasitas.sh terapkan   # tulis DB_CONNECTION_LIMIT ke .env (dengan cadangan) lalu buat ulang cbt-api
bash tools/vps/cbt-kapasitas.sh pantau     # pantauan langsung koneksi, lock, dan error saat ujian
```

`terapkan` memakai kunci deployment yang sama dengan GitHub Actions, menolak angka yang
melebihi sisa `max_connections`, dan hanya membangun ulang image bila API yang berjalan
masih versi lama. Jangan menjalankannya saat ujian sedang berlangsung: cbt-api dinyalakan
ulang (sekitar 10–30 detik). Tidak ada migrasi database.

## Memindahkan gambar base64 soal lama (9 November 2026)

Soal yang dulu diimpor dari Word bisa menyimpan gambar sebagai base64 di dalam teks soal. Data itu memperberat database, setiap pemuatan soal, dan setiap pengumpulan ujian. Impor baru sudah mengunggah gambar sebagai berkas; soal lama dipindahkan dengan:

```bash
cd /www/wwwroot/acca-cbt-new
bash tools/vps/pindahkan-gambar-base64.sh cek        # hanya membaca: lokasi dan ukuran base64
bash tools/vps/pindahkan-gambar-base64.sh jalankan   # unggah gambar, ganti dengan URL (minta konfirmasi)
bash tools/vps/pindahkan-gambar-base64.sh pulihkan /var/backups/acca-cbt/gambar-base64-<waktu>.ndjson
```

Yang dipindahkan: bank soal, opsi, stimulus, petunjuk, dan salinan soal ujian (wajib ikut agar siswa berhak membuka gambarnya). Nilai asli tiap baris dicadangkan ke `/var/backups/<proyek>/` sebelum diubah. Skrip menolak berjalan bila ada ujian yang sedang dikerjakan, memegang kunci deployment yang sama dengan GitHub Actions, dan aman dijalankan ulang. Gambar EMF/WMF dibiarkan karena tidak dapat ditampilkan browser.

**Urutan wajib:** deploy rilis yang memuat cache gambar offline (`exam-sw.js` dengan `CACHE_EXAM_IMAGES`) lebih dulu, baru jalankan pemindahan. Gambar base64 tampil saat siswa offline karena tersimpan bersama soal; gambar berkas baru tampil offline setelah service worker menyimpannya saat siswa membuka ujian secara online.

## Berbagi layar di tablet/HP dan pengecualian per periode (9 November 2026)

Tablet dan HP (Android, iPhone, iPad) tidak dapat membagikan layar dari browser. Siswa di perangkat itu kini langsung melihat pesan yang tepat, dan layar persiapan/terkunci terbuka sendiri begitu pengawas memberi pengecualian. Di panel *Pengecualian berbagi layar*, pengelola periode dapat memilih **Berlakukan untuk semua ujian di periode ini** agar satu pengecualian berlaku untuk semua mapel ASAS/ASAT/AM.

Pengecualian per periode memerlukan migrasi berikut (pengecualian per ujian tetap berjalan tanpa migrasi ini):

```bash
psql "$DATABASE_URL_HOST" -f database/migrations/20261109_01_pas_screen_share_exceptions.sql
```

`DATABASE_URL_HOST` = `DATABASE_URL` dari `.env` dengan `host.docker.internal` diganti `127.0.0.1` dan tanpa `?schema=public`. Migrasi aman dijalankan ulang. API mengenali tabel baru dalam satu menit tanpa restart.

## Konversi gambar soal lama ke WebP (10 November 2026)

Gambar soal yang diunggah setelah rilis ini otomatis diperkecil (maks. 1600 px) dan disimpan sebagai WebP. Gambar JPG/PNG/BMP yang sudah ada dikonversi dengan:

```bash
cd /www/wwwroot/acca-cbt-new
bash tools/vps/konversi-gambar-webp.sh cek        # hanya membaca: jumlah, ukuran, perkiraan penghematan
bash tools/vps/konversi-gambar-webp.sh jalankan   # konversi + ganti alamat (minta konfirmasi)
bash tools/vps/konversi-gambar-webp.sh pulihkan /var/backups/acca-cbt/konversi-webp-<waktu>.ndjson
```

Yang diperbarui: bank soal, opsi, stimulus, petunjuk, dan salinan soal ujian. WebP baru disimpan di samping berkas aslinya (`<nama>.png.webp`); berkas lama **tidak dihapus**, sehingga `pulihkan` selalu aman dan materi lain yang masih memakai berkas yang sama tidak terganggu. Gambar yang tidak menjadi lebih kecil, PNG beranimasi, dan berkas yang hilang dibiarkan. Skrip menolak berjalan bila ada ujian yang sedang dikerjakan (kecuali `--paksa`), memegang kunci deployment, dan aman dijalankan ulang.

Bila kontainer API tidak memuat pustaka `sharp`, skrip memakai kontainer sementara `node:20-bookworm-slim` (unduh sekali, perlu akses internet ke npm) dengan `DATABASE_URL` dan kredensial R2 dari `.env`; kontainer itu dihapus setelah selesai. Jalankan di luar jam ujian; siswa yang sudah menyimpan ujian untuk offline perlu membuka ujian sekali secara online agar gambar WebP ikut tersimpan.

## Membatalkan ujian yang sudah dikerjakan (10 November 2026)

Bila ujian terbuka pada waktu yang salah dan siswa sudah mulai mengerjakan, buka **Monitoring** lalu pilih **Batalkan ujian** (ujian biasa: tombol merah di kanan atas; folder ASAS/AM/PAS: menu **Tindakan**). Isi alasan dan ketik `BATALKAN`. Dalam satu transaksi:

- seluruh pengerjaan ujian itu (yang sedang berjalan maupun yang sudah dikumpulkan) beserta jawaban, log pengawasan, tangkapan layar, dan sertifikat disalin ke arsip `cbt_exam_cancellations`/`cbt_exam_cancelled_attempts`, lalu dihapus;
- ujian ditarik ke draf dan kalibrasi IRT lamanya dibuang;
- siswa yang sedang mengerjakan dikeluarkan dalam ±15 detik dengan pesan "Ujian Dibatalkan", dan salinan jawaban di perangkatnya dibersihkan.

Setelah jadwal diperbaiki, terbitkan lagi (PAS: aktifkan kembali kelasnya dari folder PAS); semua siswa mengerjakan dari awal. Proktor/Admin dapat membatalkan semua ujian; Guru hanya ujian non-PAS buatannya sendiri.

Fitur ini memerlukan migrasi berikut (tanpa migrasi, tombol menampilkan pesan dan tidak mengubah apa pun):

```bash
psql "$DATABASE_URL_HOST" -f database/migrations/20261110_01_exam_cancellations.sql
```

## Cache identitas pengguna di API (21 November 2026)

Setiap permintaan terautentikasi dulu menjalankan 7–11 query untuk membaca akun, status aktif, sekolah, dan peran. Selama ujian, heartbeat 15 detik, autosave, dan setiap gambar soal dari ratusan siswa mengalikannya menjadi ratusan query per detik ke PostgreSQL yang berbagi VPS dengan seluruh aplikasi. Kini hasilnya disimpan di memori proses API:

- Identitas & peran per pengguna: `AUTH_CONTEXT_CACHE_TTL_MS` (bawaan 30000 ms, `0` = nonaktif, maks. 300000).
- Baris sekolah: 60 detik.

Hanya hasil yang sah yang disimpan; akun tidak ditemukan, nonaktif, atau galat database selalu dibaca ulang. Login SSO, perubahan akun, dan pencabutan sesi mengosongkan entri pengguna itu seketika. Perubahan peran dari menu lain atau penonaktifan di ACCA New berlaku paling lambat satu TTL (bawaan 30 detik). Dalam mode cluster (`API_WORKERS > 1`) setiap proses punya cache sendiri.

Tidak ada migrasi database. Cukup deploy ulang `cbt-api`, sebaiknya di luar jam ujian.

## Batas resource, rotasi log, dan log galat API (21 November 2026)

Rilis ini mengurangi risiko satu VPS "down" saat ujian ramai:

1. **Batas CPU/RAM** untuk `cbt-api` (3 CPU / 3 GB), `cbt-web` (2 CPU / 2 GB), dan `cbt-scoring` (1 CPU / 1 GB). Ini plafon, bukan jatah: PostgreSQL dan acca-new tetap punya core walau CBT sibuk. Ubah lewat `CBT_API_CPUS`, `CBT_API_MEM`, dan seterusnya di `.env` (lihat `.env.example`). Samakan CPU API/web dengan `API_WORKERS`/`WEB_WORKERS`. Pantau `docker stats` saat ujian pertama setelah rilis: RAM yang terus menempel di plafon berarti batasnya perlu dinaikkan.
2. **Rotasi log Docker** (20 MB × 5 berkas per kontainer). Berlaku setelah kontainer dibuat ulang. Berkas log lama yang sudah besar tidak dipotong otomatis.
3. **Log galat API kembali terlihat.** CMD lama menjalankan API dengan `2>/dev/null`, sehingga setiap `logger.error`/`warn` NestJS dan jejak crash hilang. Hitungan 5xx dan galat pool di `cbt-kapasitas.sh pantau` pun selalu 0. CMD baru juga memakai `exec`, sehingga SIGTERM saat deploy sampai ke Node.
4. **Log HTTP lebih hemat.** Heartbeat, autosave, gambar soal, `/auth/me`, dan healthcheck hanya dicatat bila lebih lambat dari `HTTP_LOG_SLOW_MS` (bawaan 1000 ms). `HTTP_LOG_ALL=1` mengembalikan pencatatan penuh.

Setelah deploy (di luar jam ujian), jalankan pemeriksaan yang hanya membaca:

```bash
cd /www/wwwroot/acca-cbt-new
bash tools/vps/cek-database.sh
```

Skrip melaporkan apakah port PostgreSQL 5432 terbuka ke publik, index yang hilang pada kolom yang dibaca setiap permintaan (dengan saran `CREATE INDEX CONCURRENTLY`), statistik seq scan, dan ukuran log Docker. Skrip tidak mengubah apa pun.

**Port 5432 terbuka ke internet harus ditutup** di firewall aaPanel, UFW, atau penyedia VPS. Akses dari luar cukup lewat SSH tunnel (`ssh -L 5432:127.0.0.1:5432 root@<ip-vps>`). Kontainer tetap terhubung lewat `host.docker.internal`. Sebelum mempersempit `listen_addresses`, pastikan `pg_hba.conf` mengizinkan subnet Docker.

**Port 3008 kini hanya di 127.0.0.1.** Port yang dipublikasikan Docker melewati UFW, jadi `3008:3008` dulu membuat CBT bisa dibuka langsung lewat `http://<ip-vps>:3008` tanpa Nginx/HTTPS. Reverse proxy aaPanel memakai `http://127.0.0.1:3008` dan tidak terpengaruh. Bila reverse proxy Anda ternyata menunjuk IP publik, ubah ke `127.0.0.1` atau isi `CBT_WEB_BIND=0.0.0.0` di `.env` sementara. Periksa dengan:

```bash
grep -rn "proxy_pass" /www/server/panel/vhost/nginx/ | grep 3008
```

**Sebelum menutup port PostgreSQL 5432:** `.env` acca-new di VPS saat ini memakai IP publik VPS pada `DATABASE_URL`. Pindahkan acca-new ke `host.docker.internal` dulu (lihat `docs/kapasitas-server.md` di repo acca-new), baru tutup port 5432. Bila tidak, acca-new terputus dari database.

## Pencabutan sesi berlaku juga di CBT (21 November 2026)

CBT menerima token acca-new (JWT_SECRET sama), tetapi dulu tidak memeriksa versi sesinya. Logout semua sesi, ganti password, atau reset password di acca-new tidak mencabut akses token lama ke CBT sampai token itu kedaluwarsa (7 hari).

Sekarang:

- Setiap permintaan API CBT mencocokkan klaim `sessionVersion` token dengan `auth.users.raw_app_meta_data.session_version`, aturan yang sama dengan acca-new. Token dengan versi lama ditolak (401 "Sesi telah berakhir").
- Token terbitan CBT (login, SSO, perpanjangan sesi ujian) ikut membawa `sessionVersion`, sehingga pencabutan di acca-new juga mengakhiri sesi CBT.
- `revokeSessions` di CBT kini benar-benar mengganti `session_version`, sama seperti acca-new. Sebelumnya hanya menghapus baris `auth.sessions` warisan Supabase, yang tidak membatalkan JWT mana pun.
- Pencabutan berlaku paling lambat satu TTL cache identitas (`AUTH_CONTEXT_CACHE_TTL_MS`, bawaan 30 detik) pada setiap proses API.

**Transisi:** token CBT lama tanpa klaim `sessionVersion` tetap diterima selama umur aslinya (12 jam sejak diterbitkan), agar rilis ini tidak mengeluarkan siswa yang sedang ujian. Setelah itu klaim wajib ada. Tidak ada migrasi database.
