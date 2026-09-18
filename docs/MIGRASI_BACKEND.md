# Migrasi backend CBT ke NestJS + FastAPI

Dokumen kerja. Diperbarui setiap kali satu modul selesai dipindahkan.

## Arsitektur target

Sama persis dengan acca-new:

```
browser ──same-origin──> Next.js route handler ──loopback──> NestJS ──> PostgreSQL (acca_db)
                          apps/web :3003          127.0.0.1:3004         194.233.81.192:5432
                                                        │
                                                        └──loopback──> FastAPI
                                                                       127.0.0.1:8000
```

Diukur di acca-new saat menetapkan pola ini:

| Ukuran | acca-new |
|---|---|
| Route handler `app/api/**/route.ts` | 310 |
| …yang mem-proxy ke NestJS | 263 |
| …yang menyentuh database langsung | **0** |
| Komponen browser yang memanggil NestJS langsung | **0** |
| File `'use server'` | 5 |

## Aturan yang tidak boleh dilanggar

1. **`apps/web` tidak pernah menyentuh database.** Tidak ada `pg`, tidak ada
   Prisma, tidak ada `supabase.from()` di route handler. Setara aturan "0 dari
   310" di acca-new.
2. **Browser tidak pernah memanggil NestJS langsung.** NestJS mendengarkan di
   `127.0.0.1`. Tidak perlu CORS, tidak perlu rate limiting publik, dan token
   tidak pernah terbaca JavaScript halaman.
3. **Identitas selalu dari JWT.** 62 dari 213 server action lama menerima
   `userId`/`orgId` sebagai parameter dari browser sementara hanya 10 tempat
   memakai `server-authz`. Di NestJS, `@CurrentUser()` adalah satu-satunya
   sumber identitas; parameter `userId` dari klien tidak dipercaya.
4. **FastAPI tidak punya kredensial database.** Ia menerima payload, menghitung,
   mengembalikan hasil. NestJS yang membaca dan menulis.
5. **Aplikasi harus tetap jalan di setiap langkah.** Modul dipindahkan satu per
   satu; yang belum dipindahkan tetap memakai jalur lama.

> **Aturan 5 selesai masa berlakunya.** Ia ada untuk menjaga aplikasi tetap
> hidup SELAMA pemindahan bertahap. Tidak ada lagi "jalur lama": seluruh modul
> sudah pindah, dan `@supabase/supabase-js` sudah dilepas dari `apps/web`.

### Sisa Supabase di `apps/web`

Tidak ada. Berikut yang tersisa di akhir, dan ke mana perginya:

| | Cara lama | Penggantinya |
|---|---|---|
| `supabase.from(…)` | query dari browser maupun server action | seluruhnya lewat NestJS |
| `supabase.auth.*` | sesi GoTrue | cookie `cbt_session` + `/api/auth/me` |
| `channel()` / realtime | dorongan `postgres_changes` dan siaran | `lib/useAutoRefresh.ts` (penyegaran berkala) |
| Presence | `supabase.channel().track()` | **dihapus** — lihat di bawah |
| `lib/supabase.ts`, `lib/server-authz.ts`, `lib/supabase-paginate.ts` | — | dihapus |
| paket npm | `@supabase/supabase-js` | dilepas dari `apps/web/package.json` |

**Realtime diganti penyegaran berkala, bukan SSE.** Rencana semula memakai SSE
dari NestJS; yang dikerjakan adalah `useAutoRefresh`. Alasannya: seluruh
langganan yang tersisa SUDAH mati sebelum Supabase ditinggalkan — sebagian
menyebut nama tabel sebelum berawalan `cbt_` (`exams`, `exam_attempts`,
`notifications`), dan siaran pelanggaran kehilangan pengirimnya begitu
`saveQuestionAction` pindah. Jeda beberapa detik yang jujur lebih baik daripada
layar yang diam menunggu peristiwa yang tidak akan datang. SSE tetap terbuka
sebagai peningkatan berikutnya.

**Umpan pelanggaran justru membaik.** Ia dulu HANYA terisi oleh siaran, jadi
kosong setiap kali halaman pemantauan dimuat ulang. Sekarang ia dibaca dari
`cbt_attempt_security_logs` lewat `GET /proctor/exams/:examId/violations`, dan
tetap terisi setelah reload.

**Presence dihapus, tidak diganti.** Indikator "Online/Offline" di kartu
Aktivitas Login bersandar pada Supabase Presence. Satu-satunya penanda aktivitas
yang tersisa adalah `auth.users.last_sign_in_at` — waktu MASUK, bukan waktu
aktif. Menyebutnya "online" akan keliru, jadi yang ditampilkan kini hanya kapan
seseorang terakhir masuk.

## Status

### Terverifikasi berjalan

Bukan sekadar "sudah ditulis" — ketiganya benar-benar dijalankan:

```
GET /api/health   {"ok":true,"database":"acca_db","adapter":{"ok":true,"sample":true}}
GET /api/settings tanpa token   -> 401
GET /api/docs                   -> 200
RelationRegistry                -> 170 foreign key, 196 primary key

GET  /health (scoring)          {"ok":true,"service":"acca-cbt-scoring"}
POST /grading/answer tanpa kunci -> 401
POST /grading/answer mcq benar   -> {"score":5.0,"is_correct":true}

npx tsc --noEmit -p apps/web/tsconfig.json   -> 0 error
npx tsc --noEmit -p apps/api/tsconfig.json   -> 0 error
npm run build (shared + web + api)           -> sukses
pytest apps/scoring/tests                    -> 78 lolos
node tools/validate-migrations.js            -> LOLOS (13 tabel, 1 kolom)
node tools/check-adapter-coverage.js -> 203 select + 41 tabel lolos uji filter
```

`adapter.ok` pada health check bukan pemeriksaan koneksi biasa: ia menjalankan
satu query LEWAT adapter termasuk resolusi relasinya, sehingga kerusakan lapisan
itu terlihat di sini dan bukan baru ketahuan saat permintaan pengguna gagal.

### Selesai

| Bagian | Lokasi |
|---|---|
| Struktur monorepo | `apps/web`, `apps/api`, `apps/scoring`, `packages/shared` |
| Adapter query bergaya Supabase | `apps/api/src/prisma/prisma-db-adapter.ts` |
| Resolusi relasi dari FK asli | `apps/api/src/prisma/relation-registry.ts` |
| Parser & compiler select PostgREST | `apps/api/src/prisma/postgrest-select.ts` |
| Auth JWT + `auth.users` + bcrypt | `apps/api/src/auth/` |
| Pengganti `supabase.auth.admin.*` | `apps/api/src/auth/auth-users.repository.ts` |
| Penukaran tiket SSO tanpa magic link | `apps/api/src/auth/auth.service.ts` |
| Penilaian, IRT, analitik, AI | `apps/scoring/` |
| Jembatan web → NestJS | `apps/web/lib/nest-api.ts`, `nest-proxy.ts`, `app-jwt.ts` |
| Route auth baru | `apps/web/app/api/auth/{login,logout,session,me}` |
| Migrasi 8 tabel + 4 kolom | `database/migrations/` |
| Penyimpanan berkas → Cloudflare R2 | `apps/web/lib/storage.ts` |
| Otorisasi bank soal (aturan kepemilikan Guru) | `AuthorizationService.assertBankAccess` |
| Urutan soal & pengacakan opsi, satu sumber | `apps/api/src/common/question-order.ts` |
| Pemetaan jawaban ke kolomnya | `apps/api/src/common/answer-storage.ts` |
| Konversi waktu WIB ↔ UTC, satu sumber | `apps/api/src/common/wib-time.ts` |
| Pengganti realtime | `apps/web/lib/useAutoRefresh.ts` |

### Kemajuan migrasi modul

**Selesai.** Tidak ada lagi direktori `apps/web/app/actions/`.

| | |
|---|---|
| Berkas aksi tersisa | **0 dari 21** |
| Query `.from('…')` di `apps/web` | **0** |
| Route handler `app/api/**/route.ts` | **130** |
| …yang mem-proxy ke NestJS | **126** |
| …yang menyentuh database | **0** |
| Modul NestJS | **20** |

Empat route handler sengaja TIDAK mem-proxy, dan tidak satu pun menyentuh
database:

| Route | Alasan |
|---|---|
| `auth/logout` | hanya menghapus cookie sesi |
| `auth/session` | alias yang meng-ekspor ulang `auth/sso` |
| `api/route.ts` | ping kesehatan |
| `storage/upload` | unggahan ke R2 — kredensialnya memang hanya ada di `apps/web` |

Tiga route lain melakukan pekerjaan BERKAS sebelum atau sesudah mem-proxy, dengan
alasan yang sama: NestJS tidak pernah menyentuh penyimpanan.

| Route | Pekerjaan berkasnya |
|---|---|
| `question-banks/[bankId]/bulk-import` | merender MathML jadi SVG lalu mengunggahnya |
| `question-banks/[bankId]/questions/[questionId]` | menghapus gambar yatim setelah soal dihapus |
| `backup/export`, `backup/import` | membungkus/membuka ZIP, mengarsipkan gambar, tanda tangan HMAC |

### Modul yang dipindahkan

| Berkas asal | Aksi | Modul NestJS |
|---|---|---|
| ~~`settings.ts`~~ | 2 | `settings` |
| ~~`admin.ts`~~ | 1 | `exams` |
| ~~`guru.ts`~~ | 9 | `teachers` |
| ~~`security.ts`~~ | 3 | `proctoring` |
| ~~`exam-review.ts`~~ | 1 | `analytics` |
| ~~`notifications.ts`~~ | 14 | `notifications` |
| ~~`analytics.ts`~~ | 8 | `analytics` |
| ~~`student-analytics.ts`~~ | 3 | `analytics` |
| ~~`irt.ts`~~ | 1 | `grading` |
| ~~`grading.ts`~~ | 4 | `grading` |
| ~~`exam-config.ts`~~ | 12 | `exam-configs` |
| ~~`bulk-import.ts`~~ | 3 | `imports` |
| ~~`pas.ts`~~ | 29 | `pas` |
| ~~`siswa.ts`~~ | 14 | `students` |
| ~~`question.ts`~~ | 45 | `questions` |
| ~~`proktor.ts`~~ | 45 | `proctor` |
| ~~backup routes~~ | — | `backup` |

Lima berkas DIHAPUS, bukan dipindahkan: `subscription.ts`, `auth.ts`, `user.ts`,
`migration.ts` (lihat [PEMBERSIHAN_UNELMA.md](PEMBERSIHAN_UNELMA.md)).

### Kode mati yang ikut dibuang

Selama pemindahan, 43 aksi ternyata tidak punya satu pun pemanggil. Sebagiannya
juga rusak, jadi memindahkannya hanya akan memindahkan masalahnya:

| Berkas | Mati | Contoh yang memang rusak |
|---|---|---|
| `pas.ts` | 9 | `getPASDashboardStats` memakai `{ head: true }` lalu membaca `.data` — selalu null, jadi seluruh angkanya 0. `removePASSubjectAction` mencari jadwal dengan id mapel sebagai id periode. |
| `proktor.ts` | 17 | seluruh pengelolaan anggota, impor anggota/mapel/tahun ajaran, penutupan terjadwal |
| `question.ts` | 4 | `exportStimuliToXlsAction` memanggil `writeFile` dari `xlsx` — menulis ke berkas SERVER, bukan mengirim unduhan |
| `bulk-import.ts` | 2 | — |

### Cacat yang diperbaiki saat dipindahkan

Bukan penulisan ulang, melainkan kesalahan yang terlihat justru karena kodenya
dibaca ulang baris demi baris:

| Di mana | Cacatnya |
|---|---|
| `backup/import` | menulis ke tabel TANPA awalan `cbt_` (`classes`, `exams`, `answers`, …). Tabel itu tidak ada — pemulihan SELALU gagal pada sisipan pertama. |
| `backup/export` | memotong opsi jawaban dan jawaban peserta di 500 baris pertama, diam-diam. Cadangannya tampak lengkap padahal tidak. |
| `bulk-import.ts` | opsi dipasangkan lewat posisi dalam array hasil insert, padahal baris yang gagal validasi tidak ikut di-insert. Satu baris kosong membuat SELURUH opsi sesudahnya menempel pada soal yang salah. |
| `exam-config.ts`, `pas.ts` | pembangkitan massal hanya memeriksa otorisasi id PERTAMA, lalu membangkitkan sisanya tanpa pemeriksaan |
| `question.ts` | penilaian ulang dilepas tanpa `await` di dalam server action; saat permintaannya berakhir prosesnya bisa terhenti di tengah, menyisakan sebagian peserta dengan nilai berdasarkan kunci lama |
| `listQuestionBanks` dkk. | `userId` dari browser dipakai sebagai CADANGAN otorisasi ketika sesi tidak terbaca — artinya pemeriksaan bisa dilewati justru dengan tidak punya sesi |
| `siswa.ts` | `getAttemptDetailsAction` membaca SELURUH `cbt_question_dimensions` tanpa filter bank |


## Resep memindahkan satu modul

Contoh: `app/actions/settings.ts` → modul `settings`.

**1. Buat modul NestJS.**

```
apps/api/src/settings/
├── settings.module.ts
├── settings.controller.ts
├── settings.service.ts
└── dto/
```

**2. Salin badan aksinya ke service.** Inilah gunanya adapter: ganti
`getSupabaseAdmin()` dengan `this.db`, sisanya tetap.

```ts
// Sebelum — apps/web/app/actions/settings.ts
const supabaseAdmin = getSupabaseAdmin();
const { data, error } = await supabaseAdmin
    .from('acca_settings').select('id').eq('key', key).maybeSingle();

// Sesudah — apps/api/src/settings/settings.service.ts
const { data, error } = await this.db
    .from('acca_settings').select('id').eq('key', key).maybeSingle();
```

**3. Ganti `userId` dari parameter menjadi identitas terverifikasi.**

```ts
@Post()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'PROKTOR')
update(@CurrentUser() user: AuthUser, @Body() dto: UpdateSettingDto) {
  return this.service.update(user.id, dto);   // BUKAN dto.userId
}
```

**4. Daftarkan modulnya** di `apps/api/src/app.module.ts`.

**5. Buat route handler tipis di Next.js.**

```ts
// apps/web/app/api/settings/route.ts
import { NextRequest } from 'next/server';
import { proxyGet, proxyJson } from '@/lib/nest-proxy';

export async function GET(request: NextRequest) {
  return proxyGet(request, '/settings');
}
export async function POST(request: NextRequest) {
  return proxyJson(request, '/settings');
}
```

**6. Ubah pemanggilnya di frontend.** Signature dan bentuk balasannya
dipertahankan supaya penanganan galat di komponen tidak ikut berubah.

```ts
// Sebelum
import { updateSettingAction } from '@/app/actions/settings';
const res = await updateSettingAction(key, value);

// Sesudah
const res = await fetch('/api/settings', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ key, value }),
}).then((r) => r.json());
```

Bentuk `{ success, error }` dipakai konsisten di 495 tempat — dipertahankan agar
`if (!res.success) toast(res.error)` di komponen tetap berlaku apa adanya.

**7. Hapus berkas aksinya** setelah tidak ada lagi yang mengimpor.

**8. Verifikasi.** Jalankan modulnya, bandingkan hasil dengan jalur lama sebelum
menghapus kode lama.

## Yang sudah diketahui akan menghambat

### Adapter: cakupan terukur

```
select diuji       : 203
berhasil           : 203
gagal kompilasi    : 0
gagal SQL          : 0
filter .eq() diuji : 41 tabel lolos, 0 gagal
```

```bash
npm run check:adapter                      # kondisi database saat ini
node tools/check-adapter-coverage.js --with-migrations
```

**Yang ditanyakan alat ini sudah berubah.** Selama migrasi ia memindai
`apps/web` untuk menjawab "berapa banyak query yang bisa dipindahkan apa adanya?".
Seluruh query sudah pindah, jadi sekarang ia memindai `apps/api/src` dan menjawab
pertanyaan yang lebih berguna: apakah setiap query yang BENAR-BENAR dijalankan
NestJS masih cocok dengan skema `acca_db`? Jalankan setelah mengubah skema.

Mode `--with-migrations` menerapkan `database/migrations/` di dalam transaksi
yang diakhiri ROLLBACK.

**Angka select saja tidak cukup.** Versi awal alat ini hanya menguji bentuk
`select` tanpa satu pun filter, sehingga melewatkan seluruh kelas kegagalan
`operator does not exist: uuid = text` — padahal hampir setiap query nyata
memakai `.eq()` pada kolom uuid. Alat itu kini menjalankan probe kedua dengan
`.eq()` pada primary key tiap tabel.

Adapter menangani select bersarang tiga tingkat, relasi has-many dan belongs-to,
`!inner`, filter bertitik (`.eq('member_roles.roles.name', 'Siswa')`), agregat
`relasi(count)`, dan `upsert` dengan `onConflict`.

Yang **belum** didukung dan perlu ditulis manual bila ditemui: fungsi agregat
selain `count`, `order` pada tabel relasi, dan `.or()` bersarang.

### Parsing dokumen berjalan di browser

`lib/doc-parser.ts` (905 baris) dan `lib/excel-parser.ts` (666 baris) dipanggil
dari `BulkImportModal.tsx`, `StimulusManager.tsx`, dan `InstructionManager.tsx`
— semuanya komponen `'use client'`. Berkas tidak pernah diunggah; ia dibaca
langsung di perangkat pengguna.

Memindahkannya ke FastAPI berarti berkas harus diunggah lebih dulu. Itu
perubahan alur kerja, bukan sekadar pemindahan kode:

- **Untung:** `python-docx`/`openpyxl` lebih tangguh daripada `mammoth`/`xlsx`;
  konversi rumus OMML→MathML tidak lagi dikirim ke browser; empat dependensi
  berat (`mammoth`, `mathjax-full`, `omml2mathml`, `jszip`) keluar dari bundel.
- **Rugi:** unggah membutuhkan waktu untuk berkas besar, dan butuh endpoint baru
  dengan batas ukuran serta otorisasi.

Belum dikerjakan. Perlu keputusan sebelum dimulai.

### Halaman penilaian tugas tidak pernah berfungsi — sudah diperbaiki

`getAttemptDetailsForGrading` di `app/actions/guru.ts` menyeleksi kolom
`question`, padahal namanya `question_text`. Query itu **selalu** gagal,
`answersError` selalu terisi, dan fungsinya selalu mengembalikan `null` —
sehingga `/dashboard/guru/grading/assignment/[attemptId]` tidak pernah
menampilkan satu pun jawaban untuk dinilai.

Halaman itu juga membaca `qInfo.metadata?.is_multi_topic` dan `qInfo.options`,
yang sama sekali tidak ada di select tersebut.

Ditemukan lewat `check-adapter-coverage.js`, dan sudah diperbaiki: kolomnya
dibetulkan, `metadata` serta relasi opsi ikut diseleksi. **Perlu diuji manual**
— belum pernah ada yang melihat halaman ini bekerja.

### Masuk ke CBT: satu-satunya jalan lewat acca-new

CBT **tidak punya halaman login** dan tidak seharusnya punya. Pengguna masuk di
acca-new (`D:cca-new`), dan kedua aplikasi berbagi basis data `acca_db` yang
sama.

    acca-new :3002                          acca-cbt :3003
    ─────────────────────────────────────────────────────────────────────
    pengguna klik "CBT"
      -> GET /api/sso/cbt
         verifikasi cookie acca_session
         periksa hak akses cbt-app
         petakan peran -> Admin/Proktor/Guru/Pengawas/Siswa
         terbitkan tiket 5 menit (CBT_SSO_SECRET)
      -> 302 ke  ────────────────────────>  GET /api/auth/sso?token=…
                                              -> NestJS POST /auth/sso
                                                 verifikasi tiket
                                                 samakan peran di acca_db
                                                 terbitkan JWT CBT
                                              <- cookie httpOnly cbt_session
                                            302 ke /?sso_role=…
                                              -> GET /api/auth/me
                                                 peran dibaca ulang dari DB
                                              -> /dashboard/<peran>

Tiga variabel harus cocok antar-proyek:

| Variabel | Di mana | Kalau tidak cocok |
|---|---|---|
| `CBT_SSO_SECRET` | acca-new `apps/web/.env.local` ↔ acca-cbt `apps/api/.env` | Tiket ditolak 401, pengguna terpental ke halaman "Gagal Masuk ke CBT" |
| `JWT_SECRET` | acca-new ↔ acca-cbt (web **dan** api) | Sesi terbit tetapi setiap permintaan berikutnya 401 |
| `NEXT_PUBLIC_CBT_URL` | acca-new | Pengalihan mendarat di alamat yang salah |

`CBT_SSO_SECRET` HANYA perlu ada di `apps/api/.env`. Yang memverifikasi tiket
adalah NestJS; route handler Next.js cuma meneruskannya. Menyalin rahasia itu ke
`apps/web` berarti menambah satu tempat lagi yang bisa bocor tanpa satu pun
manfaat.

`NEXT_PUBLIC_ACCA_URL` di CBT menunjuk WEB acca-new (`:3002`), bukan API-nya
(`:3001`). Nilai cadangan di kode sempat salah menunjuk `:3001`, sehingga
pengguna tanpa sesi dipantulkan ke port yang tidak punya halaman login sama
sekali.

#### Yang dibongkar dari alur lama

`apps/web/app/api/auth/sso/route.ts` dulu menukar tiket dengan **magic link
Supabase**, lalu menyerahkan access + refresh token lewat fragment URL agar
dipungut klien Supabase di browser. Dua masalahnya:

1. Ia bergantung penuh pada Supabase Auth, yang sudah tidak ada setelah pindah
   ke PostgreSQL murni — seluruh alur masuk akan berhenti bekerja.
2. Kedua aplikasi menggerakkan SATU keluarga refresh token. Supabase
   merotasinya tiap pemakaian, jadi aplikasi yang menyegarkan belakangan
   menyodorkan token yang sudah dikonsumsi, keluarganya dicabut, dan salah satu
   sisi kehilangan sesinya. Bila itu terjadi di tengah ujian, seluruh autosave
   jawaban ikut ditolak — inilah "Sesi tidak ditemukan" yang dulu hanya sembuh
   dengan berpindah perangkat.

Alamatnya dipertahankan persis (`/api/auth/sso`) karena itulah yang sudah
terpasang di produksi acca-new; isinya yang diganti. `/api/auth/session` kini
hanya alias ke sana.

Halaman depan juga diperbaiki: ia memeriksa `/api/auth/me` LEBIH DULU. Sebelum
itu ia menunggu sesi Supabase yang tidak akan pernah muncul, lalu memantulkan
pengguna kembali ke acca-new dengan `cbt-no-session` — padahal ia baru saja
berhasil masuk.

### Peran dari acca-new tidak pernah sampai ke CBT — sudah diperbaiki

Ditemukan saat menguji alur di atas: tiket yang membawa `role: "Siswa"` untuk
akun ber-peran Guru tidak mengubah apa pun. Peran di CBT tidak pernah
disinkronkan sekali pun, sejak fitur itu ada.

`syncSsoMembership` mengambil id keanggotaan dari hasil

    .upsert({ organization_id, user_id }, { onConflict: 'organization_id,user_id' })
    .select().single()

Seluruh kolom payload-nya adalah kolom konflik, sehingga tidak ada yang bisa
diperbarui — dan adapter menjatuhkan kasus itu ke `ON CONFLICT DO NOTHING`.
`RETURNING` tidak menghasilkan baris, pemanggil menerima `data: null` **tanpa
error**, lalu `if (!member) return;` melewati seluruh penyamaan peran tanpa
suara.

Akibatnya persis yang dicegah oleh komentar di fungsi itu: bekas Proktor yang
kini Guru tetap terbaca Proktor di CBT selamanya, dan Guru yang baru diangkat
jadi Proktor tidak pernah mendapat aksesnya.

Adapter kini mengikuti PostgREST (`merge-duplicates`): kolom konflik ditugaskan
ke dirinya sendiri, yang sah di PostgreSQL dan membuat barisnya ikut
dikembalikan. `if (!member)` juga tidak lagi diam — ia mencatat galat.

Terverifikasi dua arah terhadap `acca_db`: tiket `"Guru,Proktor"` menambahkan
Proktor, tiket `"Guru"` berikutnya mencabutnya kembali.

### Setiap kolom `numeric` sempat terbaca 0 — sudah diperbaiki

Ditemukan saat memverifikasi modul `analytics`: analisis ujian melaporkan
rata-rata 0, tertinggi 0, terendah 0, dan 72 dari 72 peserta masuk kelompok
"0-20" — padahal di database nilainya 24 sampai 98.

Penyebabnya di `serializeValue` pada adapter. Kolom `numeric` tiba dari Prisma
sebagai objek `Prisma.Decimal`, dan cabang "kalau objek, salin propertinya"
MEMBONGKARNYA jadi isi dalamnya:

    { s: 1, e: 1, d: [77, 2151898, 7341773] }

`Number(...)` atas objek itu NaN, lalu pola `Number(x) || 0` yang dipakai di
mana-mana mengubahnya jadi **0**. Tidak ada galat, tidak ada peringatan; angkanya
hanya salah.

Yang terdampak adalah seluruh 8 kolom `numeric` di skema:

| Tabel | Kolom |
|---|---|
| `cbt_exam_attempts` | `total_score` |
| `cbt_answers` | `score` |
| `cbt_bank_question_options` | `weight` |
| `cbt_pas_subjects` | `passing_score` |
| `cbt_dimension_interpretations` | `min_score`, `max_score` |
| `cbt_payments` | `amount` |
| `cbt_subscription_plans` | `price` |

Artinya nilai ujian, bobot opsi PG kompleks, ambang kelulusan PAS, dan
interpretasi dimensi semuanya akan terbaca nol setelah cutover. Ini kesalahan
paling berdampak yang ditemukan selama migrasi, dan ia tidak akan muncul sebagai
galat — hanya sebagai nilai nol yang tampak wajar.

Penjaganya sekarang: `Prisma.Decimal` diubah jadi angka (PostgREST juga
mengirimnya sebagai angka JSON), `Buffer` jadi base64, dan objek yang BUKAN
objek polos dibiarkan utuh alih-alih dibongkar.

Terverifikasi ulang terhadap `acca_db`: `score_stats` kini
`{average: 77, median: 79.7, highest: 98.7, lowest: 24.7}` dan sebaran nilainya
`0-20:0  21-40:3  41-60:7  61-80:26  81-100:35`.

### Review hasil ujian siswa tidak pernah menampilkan apa pun

`cbt_exam_attempt_questions` **kosong sama sekali** di `acca_db` (0 baris), dan
tidak ada satu pun `INSERT` ke tabel itu di seluruh kode. Tabel itu hanya pernah
dibaca: sebagai penjaga hapus soal, sebagai pembersihan saat ujian dihapus, dan
oleh `getExamReview`.

Akibatnya `/dashboard/siswa/results/review/[attemptId]` selalu menampilkan
review dengan 0 soal, skor 0, nilai E — untuk setiap siswa, setiap ujian.

Perilaku itu **dipertahankan apa adanya** saat dipindahkan; memperbaikinya di
tengah migrasi berarti mengarang perilaku baru. Perbaikannya sendiri sudah
terlihat: susun review dari `cbt_answers` yang di-join ke `cbt_bank_questions`,
persis seperti `getAttemptReviewForStaff` yang memang bekerja (terbukti
mengembalikan 47 jawaban untuk attempt yang sama).

### Berkas yang dihapus, bukan dipindahkan

`subscription.ts` dan `auth.ts` tidak dipindahkan ke NestJS. Keduanya kode mati
warisan produk asal aplikasi, dan querynya merujuk kolom yang tidak ada.
Memindahkannya berarti membuat kode rusak tampak seperti fitur yang berfungsi.
Rinciannya di [PEMBERSIHAN_UNELMA.md](PEMBERSIHAN_UNELMA.md).

### Kunci OpenAI ada di dalam repo

`apps/web/app/actions/ai.ts` menuliskan kunci OpenAI sebagai nilai cadangan di
kode, dan kunci itu ada di riwayat git. **Harus dianggap bocor dan dicabut.**
`apps/scoring` sudah tidak punya nilai cadangan.

## Cutover

Selesai, kecuali satu langkah yang butuh akses server.

| | Langkah | Status |
|---|---|---|
| 1 | Cabang Supabase di `middleware.ts` | selesai |
| 2 | `/api/auth/session` jadi alias `/api/auth/sso` | selesai |
| 3 | Hapus `lib/supabase.ts`, `lib/server-authz.ts`, `lib/supabase-paginate.ts`, dan paket `@supabase/*` | selesai |
| 4 | `.from(` di `apps/web` | **0** |
| 5 | `.github/workflows/deploy.yml` membangun dan menjalankan ketiga layanan | **belum** |

```bash
grep -rn "\.from('" apps/web --include=*.ts --include=*.tsx | wc -l   # 0
grep -rn "supabase" apps/web --include=*.ts --include=*.tsx | wc -l   # hanya komentar
```

### Langkah 5 — yang tersisa

`deploy.yml` masih berasal dari masa satu-aplikasi: ia menjalankan `npm install`
dan `npm run build` di `/www/wwwroot/cbt-app`, lalu menyerahkan restart ke
Node.js Manager aaPanel. Itu tidak lagi cukup.

`npm run build` memang sudah membangun ketiganya (`shared` → `web` → `api`),
tetapi deploy-nya belum:

- **NestJS** perlu dijalankan sebagai layanan tersendiri di `127.0.0.1:3004`
  (`node apps/api/dist/main`), dan di-restart setiap deploy.
- **FastAPI** perlu dijalankan di `127.0.0.1:8000`
  (`uvicorn app.main:app --port 8000`), dengan lingkungan Python-nya sendiri.
  Dependensinya di `apps/scoring/requirements.txt`; ia TIDAK tersentuh
  `npm install`.
- **Variabel lingkungan** `apps/api/.env` dan `apps/scoring/.env` harus ikut
  dipulihkan seperti `.env.production` — keduanya memuat `DATABASE_URL`,
  `JWT_SECRET`, dan `SCORING_API_KEY`.

Ini sengaja tidak ditebak dari sini: pilihan manajer prosesnya (systemd, PM2,
atau Node.js Manager aaPanel) menentukan bentuk skripnya, dan salah tebak berarti
deploy berikutnya menjatuhkan aplikasi yang sedang dipakai.
