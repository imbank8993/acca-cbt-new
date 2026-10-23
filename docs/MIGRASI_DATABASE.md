# Migrasi database CBT ke PostgreSQL `acca_db`

> **SELESAI — cutover dijalankan 16 September 2026.** `acca_db` kini
> satu-satunya sumber data CBT. Supabase tidak lagi dipakai untuk database,
> identitas, maupun penyimpanan berkas, dan dokumen ini disimpan sebagai catatan
> apa yang dikerjakan beserta bentuk akhir skemanya.
>
> Penyimpanan berkas pindah ke Cloudflare R2 dan konfigurasinya tidak lagi ada
> di tabel `acca_settings` — lihat [apps/web/lib/storage.ts](../apps/web/lib/storage.ts)
> dan `CLOUDFLARE_R2_*` di [apps/web/.env.example](../apps/web/.env.example).

## Ringkasan

Database tujuan:

| | |
|---|---|
| Host | `194.233.81.192:5432` |
| Database | `acca_db` — sama dengan acca-new |
| Versi | PostgreSQL 16.15 (Ubuntu) |
| Schema | `auth`, `public`, `storage`, `realtime`, `vault`, `graphql`, `extensions` |

`acca_db` adalah hasil restore database Supabase, jadi schema `auth` ikut
terbawa. Ini penting: `cbt_profiles.id` merujuk `auth.users.id`, sehingga seluruh
relasi data CBT tetap utuh dan **tidak ada pemetaan ulang pengguna**.

### Isi tabel `cbt_*` di `acca_db`

45 tabel. Angka di bawah adalah keadaan salinan 13 Agustus 2026, yaitu sebelum
dump cutover dimuat — disimpan sebagai pembanding, bukan sebagai jumlah baris
saat ini:

| Tabel | Baris |
|---|---|
| `cbt_answers` | 5.888 |
| `cbt_exam_attempts` | 139 |
| `cbt_class_members` | 667 |
| `cbt_bank_question_options` | 396 |
| `cbt_organization_members` | 157 |
| `cbt_member_roles` | 157 |
| `cbt_profiles` | 157 |
| `cbt_bank_questions` | 117 |
| `cbt_classes` | 92 |
| `cbt_attempt_security_logs` | 80 |
| `cbt_question_kisi_kisi` | 45 |
| `auth.users` | 308 |

## Yang dikerjakan

### 1. Salinan 13 Agustus sudah diganti dump cutover — SELESAI

```
cbt_answers        created_at terakhir : 2026-07-31
cbt_exam_attempts  created_at terakhir : 2026-07-31
cbt_profiles       created_at terakhir : 2026-08-13
```

Salinan itu diambil sekitar **13 Agustus 2026**, sementara aplikasi CBT terus
berjalan di Supabase sesudahnya. Selisih itulah yang ditutup dump cutover pada
16 September 2026.

### 2. Delapan tabel belum ada — SUDAH DIBUAT

Dirujuk kode CBT, tidak ada di `acca_db`, dan **tidak ada juga di
`database/schema.sql`**:

| Tabel | Dirujuk oleh | Akibat bila tidak ada |
|---|---|---|
| `platform_admins` | `lib/rbac.ts`, `lib/server-authz.ts` | Peran Admin/Superadmin tidak pernah terdeteksi |
| `acca_settings` | `settings.ts`, `/api/storage/*` | Konfigurasi penyimpanan berkas tidak terbaca |
| `school_years` | `proktor.ts` | Tahun ajaran tidak bisa dikelola |
| `exam_configs` (+2 tabel) | `exam-config.ts` | Penjadwalan ujian massal mati |
| `bank_categories`, `exam_classes` | `/api/backup/*` | Ekspor & impor cadangan gagal |

Tabel untuk blog, token, langganan, dan pembayaran sengaja TIDAK dibuat: seluruh
fiturnya sudah dihapus bersama pembersihan produk asal — lihat
[PEMBERSIHAN_UNELMA.md](PEMBERSIHAN_UNELMA.md).

`database/migrations/20260916_01_cbt_missing_tables.sql` membuat semuanya.

> **Bentuk tabelnya diturunkan dari pemakaian kolom di kode, bukan dari dump.**
> Kalau kelak ada kolom yang ternyata kurang, sumber kebenarannya adalah kode
> yang memakainya, bukan berkas ini.

### 3. Empat kolom belum ada — SUDAH DITAMBAHKAN

Ditemukan dengan menjalankan seluruh select hasil ekstraksi dari kode CBT ke
`acca_db`:

| Kolom | Dirujuk oleh |
|---|---|
| `cbt_profiles.email` | `analytics.ts` (3 query) |
| `cbt_profiles.unique_id` | `analytics.ts` |
| `cbt_profiles.role` | ~~`/api/storage/config`~~ — route dihapus, kini tanpa pemanggil |
| `cbt_organization_members.role` | `Sidebar.tsx` (`/api/storage/config` dihapus) |

**Kolom-kolom ini juga tidak ada di `database/schema.sql`.** Berarti salah satu
dari dua kemungkinan:

**(a)** Kolom ditambahkan langsung lewat dasbor Supabase tanpa pernah masuk repo.
`20260916_02_cbt_missing_columns.sql` menyusulkannya.

**(b)** Kolomnya memang tidak pernah ada, dan query yang merujuknya sudah gagal
diam-diam selama ini. Pemanggilnya menulis `const { data } = await ...` tanpa
memeriksa `error`, jadi kegagalannya tidak pernah terlihat.

Keempatnya kini ada di `acca_db`, dan `cbt_profiles.email` sudah di-backfill
dari `auth.users` (157 baris). Menambahkan kolom yang ternyata tidak dipakai
tidak berbahaya. Yang berbahaya adalah menganggap fitur berjalan padahal
kolomnya kosong.

### 4. Satu kesalahan di kode, bukan di skema

`app/actions/guru.ts` menyeleksi `cbt_bank_questions(id, question, ...)`. Kolom
itu bernama `question_text`. Jangan tambahkan kolom `question` — perbaiki
querynya saat modul `teachers` dipindahkan.

### 5. `cbt_organization_members.role` sebaiknya dihapus belakangan

Sumber kebenaran peran adalah `cbt_member_roles` → `cbt_roles`, dan seluruh
penentuan peran memakai jalur itu. Kolom `role` yang didenormalisasi akan basi.
Migrasi menambahkannya agar query yang ada berhenti gagal, tetapi kedua
pemanggilnya sebaiknya diubah memakai relasi, lalu kolomnya dibuang.

## Menjalankan migrasi

Ketiga berkas idempoten — aman dijalankan ulang.

```bash
psql "$DATABASE_URL" -f database/migrations/20260916_01_cbt_missing_tables.sql
psql "$DATABASE_URL" -f database/migrations/20260916_02_cbt_missing_columns.sql
psql "$DATABASE_URL" -f database/migrations/20260916_03_drop_fitur_produk_asal.sql
```

> Berkas **03 menghapus permanen**. Jalankan hanya setelah dump cutover dimuat,
> supaya urutannya benar: tarik semuanya dulu, baru buang yang tidak dipakai.

### Status validasi

Sudah divalidasi terhadap `acca_db` **tanpa mengubah apa pun** — seluruh DDL
dijalankan di dalam satu transaksi yang diakhiri ROLLBACK:

```
tabel terbentuk : 8/8
kolom terbentuk : 4/4
tabel terhapus  : 13/13
kolom terhapus  : 1/1
email terisi    : 157 baris cbt_profiles (backfill dari auth.users)
jalankan ulang  : OK (idempoten)
ROLLBACK        : database tidak berubah
```

```bash
node tools/validate-migrations.js       # ulangi kapan saja, selalu ROLLBACK
```

Setelah migrasi diterapkan, cakupan query naik dari 242 menjadi **262 dari 263**
(`node tools/check-adapter-coverage.js --with-migrations`).

> **Sudah diterapkan permanen ke `acca_db` pada 16 September 2026.** Berkas kedua
> memuat `ALTER TABLE` pada `cbt_profiles` dan `cbt_organization_members`, yang
> mengambil ACCESS EXCLUSIVE LOCK — kalau perlu dijalankan ulang, lakukan di luar
> jam ujian.

### SQL warisan yang tidak boleh dijalankan

`legacy/supabase/get_user_id_by_email.sql` memberikan hak ke role `service_role`,
yang hanya ada di Supabase dan **gagal di PostgreSQL mandiri**. Fungsinya sudah
digantikan `AuthUsersRepository.findByEmail` di NestJS. Berkas itu dipindahkan
keluar dari `database/migrations/` agar tidak ikut terjalankan.

`tools/validate-migrations.js` dan mode `--with-migrations` hanya menjalankan
berkas bernomor tanggal (`YYYYMMDD_NN_*.sql`), sehingga SQL lepas di direktori
migrasi tidak pernah ikut terjalankan tanpa sengaja.

## Urutan cutover — dijalankan 16 September 2026

Disimpan sebagai catatan langkah yang benar-benar ditempuh. **Tidak perlu
diulang**; seluruh perintah di bawah menyentuh Supabase yang sudah tidak dipakai.

1. **Umumkan jendela pemeliharaan.** Tidak boleh ada ujian berlangsung.
2. **Hentikan penulisan ke Supabase** — matikan aplikasi CBT lama.
3. **Dump data dari Supabase.**

   Menyaring dengan `LIKE 'cbt%'` saja TIDAK CUKUP — beberapa tabel yang
   dibutuhkan CBT tidak berawalan `cbt_`, termasuk `unelma_settings` yang
   menyimpan konfigurasi penyimpanan berkas. Melewatkannya berarti unggahan
   berkas berhenti bekerja setelah cutover.

   ```bash
   pg_dump "$SUPABASE_URL" --data-only --schema=public \
     $(psql "$SUPABASE_URL" -At -c \
       "SELECT string_agg('-t public.'||table_name, ' ') FROM information_schema.tables
         WHERE table_schema='public'
           AND (table_name LIKE 'cbt%'
                OR table_name IN ('unelma_settings', 'platform_admins', 'school_years',
                                  'bank_categories', 'bank_folders', 'exam_classes',
                                  'exam_configs', 'exam_config_banks', 'exam_config_exams'))") \
     > cbt-data.sql
   ```

   Tabel blog, token, dan langganan sengaja tidak ikut — fiturnya sudah dihapus.

   **`unelma_settings` perlu perlakuan khusus.** Di `acca_db` tabelnya sudah
   bernama `acca_settings`, jadi dump-nya harus diarahkan ulang:

   ```bash
   sed -i 's/public\.unelma_settings/public.acca_settings/g' cbt-data.sql
   ```
4. **Kosongkan tabel `cbt_*` di `acca_db`** (salinan basi 13 Agustus), lalu
   muat `cbt-data.sql`.
5. **Jalankan migrasi 01 dan 02.** (Sudah diterapkan ke `acca_db` pada
   16 September 2026 — 8 tabel, 4 kolom, email 157 baris terisi. Idempoten,
   jadi menjalankannya lagi setelah dump tidak masalah.)
6. **Verifikasi jumlah baris** antara Supabase dan `acca_db` untuk ke-45 tabel.
   Lakukan SEBELUM migrasi 03 — setelah itu sebagian tabel memang sengaja hilang.
6b. **Jalankan migrasi 03** untuk membuang tabel & kolom fitur yang sudah
   dihapus dari kode. Ini permanen.
7. **Verifikasi adapter** — seluruh select harus lolos (262 dari 263; satu
   kegagalan yang tersisa adalah artefak ekstraksi dari komentar dokumentasi):
   ```bash
   node tools/check-adapter-coverage.js
   ```
8. **Arahkan `DATABASE_URL`** di `apps/api/.env` ke `acca_db`.
9. **Nyalakan aplikasi baru**, jalankan satu ujian uji dari awal sampai submit.
10. **Simpan Supabase tetap hidup dan hanya-baca** selama beberapa hari sebagai
    jalan mundur.

### Sesudah cutover

Konfigurasi penyimpanan berkas **tidak ikut** dari `unelma_settings`: baris
`storage_config` tidak pernah ada di `acca_settings` (isinya hanya `app_config`),
sehingga setiap unggahan diam-diam jatuh ke provider default yang sudah mati.
Karena itu penyimpanan dipindahkan seluruhnya ke Cloudflare R2 dengan
konfigurasi dari environment — lihat bagian "Penyimpanan berkas" di
[README.md](../README.md).

Tidak ada satu pun tabel `cbt_*` yang menyimpan URL Supabase Storage, jadi tidak
ada berkas CBT yang perlu dipindahkan. (Empat kolom milik acca-new masih memuat
URL lama: `file_uploads.file_url`, `laporan_piket_detail.dokumentasi_url`,
`registrasi_sanggar.pas_foto`, `sv_unggahan_guru.file_url` — di luar cakupan CBT.)

## Pembersihan sisa produk asal

Pembaruan verifikasi 24 Oktober 2026: migrasi `20260916_03` sudah diterapkan
dan seluruh objek sasarannya sudah tidak ada. Penghapusan fitur token pada
`20260916_04_*.sql.TERTUNDA` ditunda atas permintaan pemilik karena dua kolom
ujian masih diperlukan secara tidak langsung oleh Prisma client `acca-new` yang lama.
Dashboard siswa dan staf menggunakan `cbt_exams.findMany({ include: ... })`,
yang mengambil semua scalar field dari skema client. Definisi `is_paid` dan
`token_price` perlu dihapus dari skema `acca-new`, kemudian client dibangun
ulang dan aplikasinya dideploy sebelum kolom database dihapus. Tidak adanya
rujukan field eksplisit belum cukup untuk membuktikan kompatibilitas.

Migrasi `20261010_01_grading_retry_indexes.sql` sudah diterapkan pada database
24 Oktober 2026. Kedua indeks antrean penilaian sudah diperiksa aktif dan valid.

Bagian berikut mencatat hasil pemeriksaan historis sebelum pembersihan tersebut.

`20260916_03_drop_fitur_produk_asal.sql` membuang **13 tabel** dan **1 kolom**
yang fiturnya sudah dihapus dari kode.

> **`acca_db` dipakai bersama acca-new.** Daftar hapusnya sudah diperiksa
> terhadap kedua basis kode. Fitur token (`cbt_token_transactions`,
> `cbt_unlocked_exams`, `token_balance`, `is_paid`, `token_price`) MASIH dirujuk
> kode acca-new, jadi penghapusannya dipisah ke `20260916_04_*.sql.TERTUNDA`
> dan tidak ikut terjalankan. Lihat [PEMBERSIHAN_UNELMA.md](PEMBERSIHAN_UNELMA.md).

Sudah ada di `acca_db` (semuanya kosong, kecuali dua yang disebut di bawah):
`cbt_payments`, `cbt_organization_subscriptions`, `cbt_subscription_plans`,
`cbt_permissions` (11 baris), `cbt_role_permissions` (24 baris).

Kedua tabel izin itu berisi data tetapi **nol rujukan dari kode** — otorisasi CBT
berjalan lewat `cbt_member_roles` → `cbt_roles`, bukan lewat katalog izin ini.

Baru muncul setelah dump cutover: `cbt_payment_transactions`,
`user_subscriptions`, `user_token_purchases`, `unelma_posts` (+4 tabel).

Kolom: `cbt_organizations.hero_image_url` — kosong di `acca_db`.

**Tidak dihapus dengan sengaja:** `cbt_organizations.max_students` (tidak
dirujuk kode tetapi terisi, bisa jadi batas yang memang dikehendaki),
`cbt_organization_labels` dan `cbt_certificates` (keduanya masih dipakai), serta
`acca_settings` (menyimpan konfigurasi penyimpanan berkas — di-RENAME, bukan
dihapus).

Diverifikasi setelah ketiga migrasi diterapkan dalam transaksi: cakupan adapter
tetap **262 dari 263**. Tidak ada satu pun query yang rusak oleh penghapusan itu.

## Catatan autentikasi

Tidak ada GoTrue yang dijalankan. Schema `auth` murni menjadi penyimpan
kredensial:

- `auth.users` — 308 baris, hash bcrypt `$2a$10$`, dipakai `AuthService.login`.
- `auth.identities` — 308 baris, provider `email`. Dipertahankan agar data
  sebentuk; tidak dipakai untuk login.
- `auth.sessions`, `auth.refresh_tokens` — dikosongkan saat sesi dicabut.

Penghapusan pengguna dibuat **lunak** (`deleted_at`), bukan `DELETE`.
`cbt_profiles.id` merujuk `auth.users.id` dengan `ON DELETE CASCADE` — menghapus
permanen berarti seluruh jejak ujian, jawaban, dan nilai peserta ikut lenyap.
