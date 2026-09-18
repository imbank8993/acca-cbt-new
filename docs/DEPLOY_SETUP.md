# Deploy to VPS — Panduan Lengkap dari Awal

## Prerequisites

### Di VPS
1. Ubuntu + aaPanel terinstall
2. Node.js via nvm (`/www/server/nvm/versions/node/v24.16.0/bin/node`)
3. PM2 global: `npm install -g pm2`
4. Project sudah di-clone: `/www/wwwroot/cbt-app`

### Di GitHub
1. Repository: `github.com/imbank8993/cbt-app`
2. Branch: `master`

---

## Step 1: Setup SSH Key untuk GitHub (Deploy Key)

```bash
# Di VPS
ssh-keygen -t ed25519 -f /root/.ssh/deploy_key -N "" -q
cat ~/.ssh/deploy_key.pub   # copy outputnya
```

Buka GitHub → Settings → **Deploy Keys** → **Add deploy key** → paste public key → centang **Allow write access**.

## Step 2: Setup SSH untuk Git Pull

```bash
# Di VPS
echo "Host github.com" >> ~/.ssh/config
echo "  IdentityFile ~/.ssh/deploy_key" >> ~/.ssh/config
echo "  IdentitiesOnly yes" >> ~/.ssh/config

cd /www/wwwroot/cbt-app
git remote set-url origin git@github.com:imbank8993/cbt-app.git
git pull origin master   # test, harus berhasil
```

## Step 3: Backup .env.production

```bash
# Di VPS
cp /www/wwwroot/cbt-app/.env.production /root/.env.production.backup
```

## Step 4: Setup SSH Key untuk GitHub Actions (SSH_KEY Secret)

```bash
# Di VPS — file yang sudah ada: /root/.ssh/id_ed25519
cat /root/.ssh/id_ed25519   # copy SELURUH isi file
```

## Step 5: Setup GitHub Secrets

Buka: GitHub → Settings → **Secrets and variables** → **Actions** → **New repository secret**

| Secret Name | Value |
|---|---|
| `SSH_HOST` | `103.247.9.185` |
| `SSH_USER` | `root` |
| `SSH_KEY` | Isi file `/root/.ssh/id_ed25519` (private key) |
| `SSH_PORT` | `22` |

## Step 6: Setup aaPanel Node.js Manager

**PM2 tidak dipakai.** aaPanel yang jadi single source of truth untuk start/stop.

1. Login ke **aaPanel** (biasanya `http://VPS_IP:7800`).
2. Buka menu **App Store** → cari **"Node.js Version Manager"** (atau **PM2 Manager**) → install kalau belum ada.
3. Buka **Node.js Manager** → klik **"Add Project"**:
   - **Project root:** `/www/wwwroot/cbt-app`
   - **Run command:** `npm start`  (ekivalen `next start` di port 3002)
   - **Node version:** v24.x (sesuai yang ter-install di Step 4)
   - **Auto start:** ON (supaya nyala setelah reboot)
4. Klik **"Start"** — status harus **Running** (hijau).
5. **Watch & auto-reload (opsional):** aktifkan di setting project agar aaPanel auto-detect perubahan `.next/`.

> **Penting:** jangan jalankan `pm2 start` manual di terminal VPS. Kalau terlanjur ada instance PM2 dari setup lama, hapus dulu:
> ```bash
> pm2 delete cbt-app
> pm2 save
> pm2 list   # harus kosong untuk cbt-app
> ```

## Step 7: Test

Push ke `master` → cek tab **Actions** → workflow "Deploy to VPS" → "Pull code & build on VPS" harus hijau. Setelah build selesai, klik **"Restart"** di aaPanel untuk memuat kode baru.

---

## Struktur File

```
.github/workflows/deploy.yml   — workflow GitHub Actions (build only)
```

## Workflow

1. Push ke `master`
2. GitHub Actions SSH ke VPS → git pull
3. Load Node.js PATH → npm install → npm run build
4. **aaPanel** restart aplikasi (manual klik, atau watch-mode otomatis)

## Troubleshooting

### `npm: command not found`
→ Hardcode PATH: `/www/server/nvm/versions/node/v24.16.0/bin`

### `ssh: handshake failed: EOF`
→ Cek `SSH_HOST` benar, `SSH_PORT` = 22 (bukan port app)

### `Permission denied (publickey)`
→ Deploy key belum terdaftar di GitHub → Settings → Deploy Keys

### PM2 status errored
→ `pm2 delete cbt-app` lalu `pm2 start npm --name cbt-app -- start`
