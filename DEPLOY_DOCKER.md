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
2. **Tahap Deploy (Deploy Job)**:
   - Menghubungi VPS via SSH aman.
   - Melakukan `git fetch` & `git reset --hard` ke commit terbaru.
   - Menjalankan `docker compose up -d --build --remove-orphans`.
   - Membersihkan dangling image via `docker image prune -f`.
   - Melaporkan status kontainer aktif.

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
