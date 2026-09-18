# ACCA CBT

Aplikasi ujian berbasis komputer untuk MAN Insan Cendekia Gowa.

Monorepo tiga layanan: Next.js untuk antarmuka, NestJS untuk seluruh akses
database dan otorisasi, FastAPI untuk penilaian. Pemindahan dari monolit
Next.js **sudah selesai** — tidak ada lagi server action, tidak ada lagi query
database di `apps/web`, dan Supabase sudah dilepas sepenuhnya. Catatannya ada di
[docs/MIGRASI_BACKEND.md](docs/MIGRASI_BACKEND.md).

> **Tentang nama.** Folder repo ini `acca-cbt-new`, tetapi `acca-cbt` masih
> muncul di tiga tempat yang berbeda artinya dan memang TIDAK ikut berubah:
> `@acca-cbt/web`, `@acca-cbt/api`, `@acca-cbt/shared` adalah nama paket npm
> workspace; `acca-cbt-monorepo` nama paket akar; `acca-cbt.icgowa.sch.id` adalah
> domain produksi. Tidak satu pun merujuk nama folder, jadi mengganti nama
> foldernya tidak menuntut perubahan kode apa pun.

## Struktur

```
apps/
  web/        Next.js 16 — antarmuka. Tidak menyentuh database.
  api/        NestJS 10 + Prisma — seluruh akses database dan otorisasi.
  scoring/    FastAPI — penilaian, IRT, analitik butir, AI. Tanpa akses database.
packages/
  shared/     Tipe dan konstanta yang dipakai web maupun api.
database/
  migrations/ Migrasi SQL.
  schema.sql  Skema awal (sebagian sudah tidak sesuai — lihat MIGRASI_DATABASE.md).
docs/         Dokumen migrasi dan catatan teknis.
tools/        Skrip sekali pakai dan alat pemeriksa.
```

`apps/web` hanya memuat antarmuka dan route handler tipis. Route handler di
`app/api/**` meneruskan ke NestJS lewat `lib/nest-proxy.ts`; tidak satu pun
menyentuh database. Empat di antaranya sengaja tidak mem-proxy (logout, alias
sesi, ping kesehatan, unggahan R2), dan tiga lagi mengerjakan urusan BERKAS di
sekitar proxy-nya — perenderan persamaan, pembersihan gambar yatim, dan
pembungkusan cadangan — karena kredensial penyimpanan memang hanya ada di sana.

## Topologi

```
browser ──same-origin──> Next.js ──loopback──> NestJS ──> PostgreSQL (acca_db)
              :3008                  :3009                    :5432
                                        │
                                        └──loopback──> FastAPI :8000
```

NestJS dan FastAPI mendengarkan di `127.0.0.1` dan **tidak diekspos ke
internet**. Browser hanya berbicara dengan Next.js, dan token sesi tersimpan di
cookie httpOnly sehingga tidak pernah terbaca JavaScript halaman.

## Menjalankan

```bash
npm install

cp apps/web/.env.example apps/web/.env.local
cp apps/api/.env.example apps/api/.env
cp apps/scoring/.env.example apps/scoring/.env
# isi DATABASE_URL, JWT_SECRET (samakan dengan acca-new), INTERNAL_API_KEY,
# SCORING_API_KEY, dan CLOUDFLARE_R2_* di apps/api/.env
#
# JWT_SECRET dan INTERNAL_API_KEY harus SAMA PERSIS di apps/web dan apps/api.

npm run dev:all
```

Atau per layanan:

```bash
npm run dev:frontend    # Next.js  :3008
npm run dev:backend     # NestJS   :3009  — Swagger di /api/docs
npm run dev:scoring     # FastAPI  :8000  — dokumentasi di /docs
```

FastAPI butuh virtualenv sendiri, lihat [apps/scoring/README.md](apps/scoring/README.md).

## Pemeriksaan

```bash
npm run typecheck        # TypeScript apps/web
npx tsc --noEmit -p apps/api/tsconfig.json
npm run lint

npm run check:adapter    # jalankan setiap query yang BENAR-BENAR dipakai NestJS
                         # ke database sungguhan, untuk memastikan semuanya masih
                         # cocok dengan skemanya (hanya membaca, LIMIT 1)

npm run check:storage    # tulis–baca–hapus satu objek uji di R2, termasuk
                         # memastikan URL publiknya benar-benar terbuka

cd apps/scoring && .venv/Scripts/python.exe -m pytest tests/ -q
                         # paritas mesin penilaian terhadap kode TypeScript asli
```

## Database

PostgreSQL `acca_db` — **sama dengan acca-new**, dan sejak cutover
**16 September 2026** satu-satunya sumber data. Tidak ada lagi Supabase: tabel
CBT memakai prefix `cbt_` di schema `public`, identitas ada di schema `auth`.

Riwayat dan urutan cutover-nya ada di
[docs/MIGRASI_DATABASE.md](docs/MIGRASI_DATABASE.md).

## Penyimpanan berkas

**Cloudflare R2**, satu-satunya penyedia. Seluruh unggahan masuk lewat
`POST /api/storage/upload` dan berakhir di bucket yang sama dengan acca-new.

Konfigurasinya dibaca dari environment (`CLOUDFLARE_R2_*` di
`apps/web/.env.local`), bukan dari tabel `acca_settings` seperti dulu — lihat
[apps/web/lib/storage.ts](apps/web/lib/storage.ts). NestJS tidak menyentuh
berkas sama sekali.

> `https://pub-<hash>.r2.dev` bawaan R2 **diblokir di tingkat DNS oleh sebagian
> ISP Indonesia**. Pakai custom domain untuk `CLOUDFLARE_R2_PUBLIC_URL`.
