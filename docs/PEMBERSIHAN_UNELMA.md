# Pembersihan jejak produk asal (unelma)

Aplikasi ini disalin dari sebuah produk CBT multi-sekolah bernama *unelma*, lalu
diarahkan untuk satu sekolah: **MAN Insan Cendekia Gowa**. Dokumen ini mencatat
apa yang dibuang, apa yang diganti nama, dan apa yang sengaja dipertahankan.

Verifikasi cepat bahwa jejaknya sudah bersih:

```bash
grep -rni "unelma" apps packages tools \
  --include=*.ts --include=*.tsx --include=*.css --include=*.js \
  | grep -v node_modules | grep -v /dist/
# harus kosong
```

Satu-satunya kemunculan yang tersisa ada di `database/migrations/` — itu
disengaja, karena migrasinya perlu mengganti nama tabel lama `unelma_settings`
pada lingkungan yang sudah memilikinya.

## Kode mati — dihapus

Semuanya diperiksa tidak punya satu pun pemanggil sebelum dihapus.

| Yang dihapus | Bukti |
|---|---|
| `app/api/debug-pricelist` | Isinya hanya `{ message: 'Debug endpoint' }` |
| `app/api/debug-post` (2 rute) | Debug blog |
| `app/api/get-managed-org` | Branding halaman depan; komponen Hero-nya tidak pernah ada |
| `app/matching-test` | Komentarnya sendiri: *"Delete after use"* |
| `app/test-tnc` | Halaman uji |
| `app/exam` | Placeholder bertuliskan "EXAM ENGINE" |
| `app/actions/auth.ts` | Pendaftaran publik B2C; tidak dipanggil, dan akan MEMBUAT organisasi "ACCA Edu" yang tidak dikehendaki |
| `app/actions/subscription.ts` | Dua fungsi tanpa pemanggil, querynya merujuk kolom yang tidak ada |

## Fitur produk — dihapus

### Blog/CMS

`app/posts`, `app/post/[slug]`, `lib/posts.ts`, beserta lima tabel
(`unelma_posts`, `unelma_post_categories`, `unelma_post_tags`, dan dua tabel
penghubungnya). Tidak ada satu pun tautan ke `/posts` di seluruh UI.

### Ujian berbayar & token

`is_paid`, `token_price`, `token_balance`, `unlockExamAction`,
`getTokenBalanceAction`, serta tabel `cbt_token_transactions` dan
`cbt_unlocked_exams`.

Antarmukanya digerbangi `org?.allow_token_system` — dan kolom itu **tidak ada**
di `cbt_organizations`. `getProctorOrganization` bahkan menuliskannya
`false` secara tetap dengan komentar yang menjelaskan hal tersebut. Jadi
formulir "Ujian Berbayar (Token)" tidak pernah sekali pun tampil.

### Langganan & halaman kedaluwarsa

`dashboard/expired`, peran `Expired`, tabel `user_subscriptions`,
`user_token_purchases`, `cbt_payment_transactions`, dan pseudo-organisasi
`{ orgId: 'unelma-token', orgName: 'ACCA Edu' }`.

Penentuan peran jadi lebih sederhana: keanggotaan organisasi, metadata akun,
atau pernah mengikuti ujian.

### Marketplace lintas sekolah

Organisasi **"ACCA Edu"** adalah wadah tryout publik yang dibagikan ke semua
sekolah pada produk asalnya. `acca_db` hanya berisi SATU organisasi
(MAN Insan Cendekia Gowa), jadi pencariannya selalu nihil.

Dihapus: pencarian organisasi global di `siswa.ts` dan `student-analytics.ts`,
pengambilan "semua ujian publik di seluruh platform", flag `isGlobal`, panel
**"Riwayat Try Out ACCA"** di analitik siswa, dan pemisahan ujian
sekolah/global di dasbor siswa — yang selama ini hanya berfungsi MENYARING
ujian, karena bagian globalnya tidak pernah ditampilkan.

## Penggantian nama → `acca`

| Sebelum | Sesudah |
|---|---|
| tabel `unelma_settings` | `acca_settings` |
| bucket `unelma-uploads` | `acca-uploads` |
| `localStorage['unelma_active_role_v2']` | `acca_active_role_v2` |
| event `unelma:signout` | `acca:signout` |
| `--color-unelma-navy` dkk. | `--color-acca-*` |
| Superadmin `unelma.edu@gmail.com` | dihapus |
| `remotePatterns: **.unelma.id` | dihapus |
| rewrite `/storage/*` → `icgowa.sch.id/unelma.id/uploads/*` | dihapus |

Dua catatan penting soal risikonya:

- **Rewrite `/storage/` tidak pernah terpakai.** Tidak ada satu pun kode yang
  menghasilkan URL `/storage/...`; unggahan selalu menyimpan URL absolut dari
  `getPublicUrl()` Supabase atau base URL R2. Menghapusnya tidak memutus berkas
  apa pun.
- **`UPLOAD_BUCKET` hanya nilai cadangan.** Kode membaca
  `config.supabase?.bucket || UPLOAD_BUCKET`, jadi bucket yang sudah
  dikonfigurasi di pengaturan tetap menang. Berkas lama tidak terpengaruh.

## Dua masalah keamanan yang ikut ditemukan

**Rahasia SSO tertulis di kode.** `app/api/auth/sso/route.ts` memakai
`process.env.CBT_SSO_SECRET || 'unelma-cbt-sso-secret-key-2026-icgowa'`.
Nilai cadangan itu ada di riwayat git — siapa pun yang membacanya bisa merakit
tiket SSO yang sah untuk akun mana pun. Nilai cadangannya dibuang; kini endpoint
menolak permintaan bila variabelnya belum diset.

**Password impor seragam.** `app/api/backup/import/route.ts` membuat setiap akun
hasil impor dengan `password: 'unelma123'`. Siapa pun yang tahu nilainya bisa
masuk sebagai peserta mana pun. Diganti `randomUUID()` per akun — konsekuensinya
akun hasil impor wajib melalui atur ulang password.

> Kedua rahasia itu harus dianggap bocor dan dicabut, terlepas dari pembersihan
> ini. Riwayat git masih memuatnya.

## Perbaikan lain yang muncul dari pembersihan

**MobileNav rusak seluruhnya.** Separuh tautannya menunjuk halaman yang tidak
pernah ada: `/dashboard/admin/orgs`, `/dashboard/admin/unelma`,
`/dashboard/siswa/library`, dan `/dashboard`. Yang terburuk
`/dashboard/settings` — muncul di SETIAP peran, sehingga tombol "Set" tidak
pernah berfungsi untuk siapa pun. Seluruh href kini menunjuk halaman yang nyata,
dan peran Pengawas yang sebelumnya terlewat ikut ditambahkan.

## Yang sengaja DIPERTAHANKAN

**Foreign key organisasi** (`cbt_organizations`, `cbt_organization_members`,
`organization_id` di hampir semua tabel) tetap ada sebagai pengikat data
internal. Kemampuan multi-sekolahnya sudah dihapus: sesi hanya membawa satu ID,
nilai `all` ditolak, seluruh query dibatasi ke sekolah instalasi, dan unique
index database mencegah sekolah kedua. Rinciannya ada di
[Tahap 20](perbaikan-2026-09-19/TAHAP-20-SINGLE-SCHOOL.md).

Browser juga tidak lagi mengirim `organizationId` untuk memilih lingkup pada
fitur operasional. Controller mengambil sekolah dari sesi JWT yang telah
diverifikasi; rincian dan daftar endpoint ada di
[Tahap 22](perbaikan-2026-09-19/TAHAP-22-KONTEKS-SEKOLAH-DARI-SESI.md).

**Kata "expired" untuk habisnya waktu ujian** tetap ada dan tidak ada
hubungannya dengan langganan — mis. `autoFinishExpiredAttemptsAction` dan
`expiredAttemptId`.

## Pembersihan database

Menghapus fitur dari kode tidak otomatis membersihkan database.
`database/migrations/20260916_03_drop_fitur_produk_asal.sql` membuang sisanya:
**13 tabel** dan **1 kolom**.

### `acca_db` dipakai bersama acca-new

Ini yang mengubah rencana. Sebelum menghapus apa pun, daftar hapus diperiksa
terhadap **kedua** basis kode. Hasilnya:

| Yang mau dihapus | acca-cbt-new | acca-new |
|---|---|---|
| `cbt_token_transactions`, `cbt_unlocked_exams` | tidak dipakai | **kode nyata** |
| `cbt_profiles.token_balance` | tidak dipakai | **5 rujukan** |
| `cbt_exams.is_paid` / `token_price` | tidak dipakai | **4 / 3 rujukan** |
| `cbt_payments`, `cbt_*_subscriptions`, `cbt_permissions`, `cbt_role_permissions` | tidak dipakai | hanya `schema.prisma` |
| `unelma_posts` (+4), `hero_image_url`, `cbt_payment_transactions`, `user_subscriptions`, `user_token_purchases` | tidak dipakai | tidak dipakai |

**Fitur token masih dirujuk kode acca-new**, lewat `prisma.cbt_unlocked_exams`
dan `prisma.cbt_token_transactions` yang bertipe di `app/actions/cbt-siswa.ts`.
Menghapusnya akan merusak repositori itu.

Karena itu penghapusannya dipecah:

- **`20260916_03_*.sql`** — yang aman: nol rujukan di kedua basis kode, atau
  hanya muncul di `schema.prisma` acca-new (Prisma tidak memvalidasi skema saat
  berjalan, jadi cukup `prisma db pull` ulang di sana).
- **`20260916_04_*.sql.TERTUNDA`** — fitur token. Berakhiran `.TERTUNDA` supaya
  tidak ikut terjalankan alat mana pun. Baru boleh diganti namanya setelah
  dipastikan acca-new tidak akan memakainya.

Modul `cbt-*.ts` di acca-new saat ini tidak punya pemanggil — halaman CBT-nya
masih memakai komponen placeholder. Jadi kodenya kemungkinan mati juga di sana.
Tetapi kode mati yang merujuk tabel tetap ranjau, dan keputusannya ada di
repositori lain.

Urutan penghapusan mengikuti ketergantungan foreign key dan **sengaja tanpa
CASCADE** — bila ternyata masih ada yang merujuk salah satu tabel, migrasi harus
gagal dengan jelas, bukan diam-diam ikut menghapus tabel lain.

Yang **tidak** dihapus dan alasannya ada di berkas SQL-nya sendiri: `max_students`
(terisi, mungkin disengaja), `cbt_organization_labels` dan `cbt_certificates`
(masih dipakai), `acca_settings` (di-rename, bukan dihapus).

Setelah ketiga migrasi diterapkan dalam transaksi, cakupan adapter tetap
**262 dari 263** — tidak ada query yang rusak oleh penghapusan itu.

## Hasil verifikasi setelah pembersihan

```
tsc --noEmit apps/web                        -> 0 error
nest build apps/api                          -> OK
pytest apps/scoring                          -> 78 lolos
node tools/validate-migrations.js            -> LOLOS (8 dibuat, 13 dihapus)
check-adapter-coverage --with-migrations     -> 262/263
```

Jumlah select yang diuji turun dari 291 menjadi 263: 28 query ikut terhapus
bersama fitur-fiturnya. Satu kegagalan yang tersisa bukan kode — regex ekstraksi
menangkap `.select('...')` di dalam komentar dokumentasi.
