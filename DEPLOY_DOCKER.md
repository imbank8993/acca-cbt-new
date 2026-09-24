# Panduan Deployment ACCA CBT Menggunakan Docker di VPS

Dokumen ini memandu langkah demi langkah cara men-deploy **ACCA CBT** ke server VPS (Ubuntu 22.04 / 24.04 LTS) menggunakan Docker dan Docker Compose.

---

## 1. Persiapan Awal di Server VPS

### A. Aktifkan Swap Memory (Sangat Disarankan untuk VPS RAM 2GB–4GB)
Swap mencegah server kehabisan memori (*Out Of Memory*) saat proses kompilasi kode:
```bash
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### B. Pasang Docker & Docker Compose
Jalankan skrip resmi Docker:
```bash
# Update paket
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git ufw

# Pasang Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Masukkan user ke grup docker agar tidak perlu 'sudo' setiap saat
sudo usermod -aG docker $USER
newgrp docker

# Verifikasi pemasangan
docker --version
docker compose version
```

---

## 2. Mengambil Proyek dari GitHub

Masuk ke direktori yang diinginkan (misal `/var/www` atau `~`):
```bash
git clone https://github.com/imbank8993/acca-cbt-new.git
cd acca-cbt-new
```

---

## 3. Konfigurasi Variabel Lingkungan (.env)

Salin templat konfigurasi Docker:
```bash
cp .env.docker.example .env
nano .env
```

Sesuaikan nilai penting berikut:
1. **`DATABASE_URL`**:
   * Jika PostgreSQL berjalan langsung di OS host VPS:
     ```env
     DATABASE_URL="postgresql://postgres:password_anda@host.docker.internal:5432/acca_db?schema=public"
     ```
2. **`JWT_SECRET` & `CBT_SSO_SECRET`**:
   * **Wajib sama persis** dengan yang ada di project `acca-new` agar login/SSO berjalan mulus.
3. **`NEXT_PUBLIC_SITE_URL` & `NEXT_PUBLIC_ACCA_URL`**:
   * Masukkan domain produksi (mis. `https://cbt.sekolah.sch.id` dan `https://app.sekolah.sch.id`).
4. **`CLOUDFLARE_R2_*`**:
   * Masukkan kredensial bucket R2 Cloudflare Anda untuk penyimpanan berkas ujian/gambar.

Simpan dengan menekan `Ctrl + O`, lalu keluar dengan `Ctrl + X`.

---

## 4. Menjalankan Aplikasi

Jalankan perintah berikut untuk merakit image dan menjalankan semua kontainer:
```bash
docker compose up -d --build
```

Docker akan mengompilasi dan mengaktifkan 3 kontainer:
1. `cbt-scoring` (FastAPI / Python - port internal 8000)
2. `cbt-api` (NestJS 10 - port internal 3009)
3. `cbt-web` (Next.js 16 - port publik 3008)

### Memeriksa Status Kontainer
```bash
docker compose ps
```
Pastikan ketiga service berstatus `Up` (healthy).

### Memeriksa Log
```bash
# Lihat log seluruh service secara realtime
docker compose logs -f

# Atau lihat log salah satu service saja:
docker compose logs -f cbt-web
docker compose logs -f cbt-api
docker compose logs -f cbt-scoring
```

---

## 5. Menghubungkan Domain & SSL dengan Nginx (Reverse Proxy)

Pasang Nginx dan Certbot untuk mendapatkan HTTPS gratis dari Let's Encrypt:
```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

Buat konfigurasi virtual host Nginx:
```bash
sudo nano /etc/nginx/sites-available/cbt.conf
```

Isikan konfigurasi berikut (ganti `cbt.domainanda.com` dengan domain Anda):
```nginx
server {
    server_name cbt.domainanda.com;

    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:3008;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Aktifkan konfigurasi dan pasang sertifikat SSL:
```bash
sudo ln -s /etc/nginx/sites-available/cbt.conf /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

# Pasang SSL Let's Encrypt otomatis
sudo certbot --nginx -d cbt.domainanda.com
```

---

## 6. Cara Update Aplikasi di Masa Mendatang

Setiap kali Anda selesai coding di laptop dan melakukan `git push` ke GitHub, cukup jalankan ini di VPS:

```bash
cd acca-cbt-new
git pull
docker compose up -d --build
```
Selesai! Versi terbaru otomatis aktif tanpa downtime yang lama.
